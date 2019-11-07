##########################################################################################################
# $Id$
##########################################################################################################
#       39_amazonEventGateway.pm
#
#       (c) 2019 by Axel Sander
#       e-mail: fdv9 at jejajo dot de
#
#       This Module can be used to together with https://github.com/n8falke/alexa-fhem-lambda
#
#       Fhem is free software: you can redistribute it and/or modify
#       it under the terms of the GNU General Public License as published by
#       the Free Software Foundation, either version 2 of the License, or
#       (at your option) any later version.
#
#       Fhem is distributed in the hope that it will be useful,
#       but WITHOUT ANY WARRANTY; without even the implied warranty of
#       MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#       GNU General Public License for more details.
#
#       You should have received a copy of the GNU General Public License
#       along with fhem.  If not, see <http://www.gnu.org/licenses/>.
#
###########################################################################################################################
#
# Definition: define <name> amazonEventGateway
#
###########################################################################################################################

package main;

use strict;
use warnings;
use JSON;
require 'HttpUtils.pm';

sub amazonEventGateway_Initialize($)
{
  my ($hash) = @_;

  $hash->{SetFn}    = 'amazonEventGateway_Set';
  $hash->{DefFn}    = 'amazonEventGateway_Define';
  $hash->{AttrList} = 'disable disabledForIntervals clientId clientSecret gateway';
  #                   . $readingFnAttributes;
}


###################################
sub amazonEventGateway_setStatus($$$)
{
  my ($hash, $state, $msg) = @_;
  $hash->{STATE} = $state;
  return $msg;
}

###################################
sub amazonEventGateway_sendEvent
{
  my ( $hash, $event ) = @_;

  $hash->{STATE} = 'sending event';
  HttpUtils_NonblockingGet(
      {
        url => AttrVal($hash->{NAME}, 'gateway', 'https://api.eu.amazonalexa.com/v3/events'),
        timeout => 10,
        hash => $hash,
        header => { 'Content-Type' => 'application/json' },
        data => encode_json( { event => $event, context => { properties => [] } } ),
        callback => sub {
          my ($param, $err, $data) = @_;
          my $hash = $param->{hash};
          my $name = $hash->{NAME};
          if ($err)
          {
            Log3($name, 2, "sending event failed: $err");
            $hash->{RESPONSE} = $err;
            $hash->{STATE} = 'event failed';
          }
          else
          {
            $hash->{STATE} = 'event sent';
            if ( $data )
            {
              $hash->{RESPONSE} = $data;
              my $json = eval { decode_json($data) };
              if($@)
              {
                Log3($name, 2, "($name) - JSON error requesting token: $@");
                return;
              }
            }
            else
            {
              $hash->{RESPONSE} = 'OK';
            }
            readingsBeginUpdate($hash);
            readingsBulkUpdate($hash, "state", $hash->{STATE});
            readingsEndUpdate($hash, 1);

            # send event if waiting events in queue
            amazonEventGateway_sendEvent($hash,  shift @{$hash->{QUEUE}} )
              if @{$hash->{QUEUE}};
          }
        }
      });
}

###################################
sub amazonEventGateway_Set($@)
{
  my ($hash, $name, $cmd, $param, $reading, @a) = @_;

  return 'no set command specified' if !$cmd;
  return 'unexpected parameter' if @a && $cmd eq 'send';

  if ($cmd eq 'code')
  {
    return 'Function used from lambda' if !$param;
    Log3($name, 4, "Got oauth code: $param");
    $hash->{CODE} = $param;
    # "refreshToken" can not be used any more
    readingsSingleUpdate($hash, "refreshToken", '', 0);
  }

  if ($cmd eq 'send')
  {
    return "set $name send <device> <reading>"
      if !$param || !$reading;

    my $token = ReadingsVal($name, 'accessToken', undef)
      or return 'Please peform auth binding';

    # $parm = device name with change
    my $endpoint = AttrVal($param, 'EchoWord', undef)
      or return "$param has no attribute EchoWord";
    $endpoint =~ tr/a-zA-Z0-9/_/c;

    my $value = ReadingsVal($param, $reading, undef);
    return "reading $reading from $param not found"
      if !defined $value;

    my $tz = fhemTzOffset(0) / 3600;
    my $timestamp = ReadingsTimestamp($param, $reading,'') . "+0$tz:00";
    substr($timestamp, 10, 1, 'T');

    my %event = (
      header => {
        messageId => genUUID(),
        namespace => 'Alexa',
        name => 'ChangeReport',
        payloadVersion => 3
      },
      endpoint => {
        scope => {
          type => 'BearerToken',
          token => $token
        },
        endpointId => $endpoint,
        cookie => { motion => $param },
      },
      payload => {
        change => {
          cause => { type => "PHYSICAL_INTERACTION" },
          properties => [
            {
              namespace => 'Alexa.MotionSensor',
              name => 'detectionState',
              value => $value eq 'on' ? 'DETECTED' : 'NOT_DETECTED',
              timeOfSample => $timestamp,
              uncertaintyInMilliseconds => 10
            }
          ]
        }
      }
    );

    # no waiting events and token valid?
    if (!@{$hash->{QUEUE}}
        && time() < ReadingsVal($name, 'tokenExpires', 0))
    {
      amazonEventGateway_sendEvent($hash, \%event);
      return undef;
    }

    # push new event in queue
    push @{$hash->{QUEUE}}, \%event;
  }

  if ($cmd eq 'code' || $cmd eq 'token' || $cmd eq 'send')
  {
    my $clientId = AttrVal($name, 'clientId', undef)
      or return amazonEventGateway_setStatus($hash, 'config missing',
          "Please: attr $name clientId <clientId> and try set $name token");

    my $clientSecret = AttrVal($name, 'clientSecret', undef)
      or return amazonEventGateway_setStatus($hash, 'config missing',
          "Please: attr $name clientSecret <clientSecret> and try set $name token");

    my %data = ( client_id     => $clientId,
                 client_secret => $clientSecret );
    if (my $refreshToken = ReadingsVal($name, "refreshToken", ''))
    {
      $data{grant_type} = 'refresh_token';
      $data{refresh_token} = $refreshToken;
    }
    else
    {
      $data{grant_type} = 'authorization_code';
      $data{code} = $hash->{CODE}
          or return "Code for $name needs to be submitted by Auth-Request to lambda";
    }

    $hash->{STATE} = 'getting token';
    HttpUtils_NonblockingGet(
        {
          url => $hash->{AUTH_URI},
          hash => $hash,
          timeout => 6,
          data => \%data,
          callback => sub {
            my ($param, $err, $data) = @_;
            my $hash = $param->{hash};
            my $name = $hash->{NAME};
            if ($err)
            {
              Log3($name, 2, "token response failed: $err");
              $hash->{AUTH_RESPONSE} = $err;
              $hash->{STATE} = 'token request failed';
            }
            elsif ($data)
            {
              $hash->{AUTH_RESPONSE} = 'OK';
              my $json = eval { decode_json($data) };
              if($@ || !$json->{access_token})
              {
                $hash->{STATE} = 'token request failed';
                Log3($name, 2, "($name) - JSON error requesting token: $@");
                return;
              }
              $hash->{STATE} = 'token fetched';
              readingsBeginUpdate($hash);
              readingsBulkUpdate($hash, "accessToken", $json->{access_token});
              readingsBulkUpdate($hash, "refreshToken", $json->{refresh_token});
              readingsBulkUpdate($hash, "tokenExpires", $json->{expires_in} + time() - 4);
              readingsBulkUpdate($hash, "state", $hash->{STATE});
              readingsEndUpdate($hash, 1);

              # send event if waiting events in queue
              amazonEventGateway_sendEvent($hash,  shift @{$hash->{QUEUE}} )
                if @{$hash->{QUEUE}};
            }
          }
        });
    return undef;
  }

  return "Unknown argument $cmd, choose one of send code token";
}

sub amazonEventGateway_Define($$)
{
  my ($hash, $def) = @_;
  my @a = split("[ \t][ \t]*", $def);

  return "Wrong syntax: use define <name> amazonEventGateway [auth api uri]" if @a > 3;

  $hash->{AUTH_URI} = $a[2] || 'https://api.amazon.com/auth/o2/token';
  $hash->{QUEUE} = [];

  return undef;
}

1;

=pod
=item helper
=item summary    amazonEventGateway device
=item summary_DE amazonEventGateway Ger&auml;t
=begin html

<a name="amazonEventGateway"></a>
<h3>amazonEventGateway</h3>
<ul>

  Send device changes to amazon alexa event gateway.
  <br><br>

  <a name="amazonEventGatewaydefine"></a>
  <b>Define</b>
  <ul>
    <code>define &lt;name&gt; amazonEventGateway</code>
    <br><br>

    Example:
    <ul>
      <code>define echoEventGateway amazonEventGateway</code><br>
      <code>attr clientId amzn1.application-oa2-client.1234567890abcdef1234567890abcdef</code><br>
      <code>attr clientSecret 12345678901234567890abcdef12345678901234567890abcdefabcdefabcdef</code><br>
    </ul>
  </ul>
  <br>

  <a name="amazonEventGatewayset"></a>
  <b>Set</b>
  <ul>
    <li><code>set &lt;name&gt; refresh</code><br>
        Refresh auth token.</li>
    <li><code>set &lt;name&gt; send &lt;device&gt; &lt;reading&gt;</code><br>
        Send event for &lt;device&gt; with change in &lt;reading&gt; to gateway.</li>
  </ul>
  <br>

  <a name="amazonEventGatewayget"></a>
  <b>Get</b> <ul>N/A</ul><br>

  <a name="amazonEventGatewayattr"></a>
  <b>Attributes</b>
  <ul>
    <li><a href="#disable">disable</a></li>
    <li><a href="#disabledForIntervals">disabledForIntervals</a></li>
    <li><a name="clientId">clientId</a><br>
      ClientId from the alexa skill kit event permission page.</li>

    <li><a name="clientSecret">clientSecret</a><br>
      ClientSecret from the alexa skill kit event permission page.</li>

    <li><a href="#readingFnAttributes">readingFnAttributes</a></li>
  </ul>
  <br>

</ul>

=end html

=begin html_DE

<a name="amazonEventGateway"></a>
<h3>amazonEventGateway</h3>
<a name="amazonEventGateway"></a>
<h3>amazonEventGateway</h3>
<ul>

  Sende veränderungen an geräten direkt zum amazon alexa event gateway.
  <br><br>

  <a name="amazonEventGatewaydefine"></a>
  <b>Define</b>
  <ul>
    <code>define &lt;name&gt; amazonEventGateway</code>
    <br><br>

    Example:
    <ul>
      <code>define echoEventGateway amazonEventGateway</code><br>
      <code>attr echoEventGateway clientId amzn1.application-oa2-client.1234567890abcdef1234567890abcdef</code><br>
      <code>attr echoEventGateway clientSecret 12345678901234567890abcdef12345678901234567890abcdefabcdefabcdef</code><br>
    </ul>
  </ul>
  <br>

  <a name="amazonEventGatewayset"></a>
  <b>Set</b>
  <ul>
    <li><code>set &lt;name&gt; refresh</code><br>
        Refresh auth token.</li>
    <li><code>set &lt;name&gt; &lt;device&gt; &lt;reading&gt;</code><br>
        Sende event für &lt;device&gt; with Änderungen im &lt;reading&gt; zum gateway.</li>
  </ul>
  <br>

  <a name="amazonEventGatewayget"></a>
  <b>Get</b> <ul>N/A</ul><br>

  <a name="amazonEventGatewayattr"></a>
  <b>Attributes</b>
  <ul>
    <li><a href="#disable">disable</a></li>
    <li><a href="#disabledForIntervals">disabledForIntervals</a></li>
    <li><a name="clientId">clientId</a><br>
      ClientId wird auf der alexa skill kit Seite unter Berechtigungen: events angezeigt.</li>

    <li><a name="clientSecret">clientSecret</a><br>
      ClientSecret fwird auf der alexa skill kit Seite unter Berechtigungen: events angezeigt.</li>

    <li><a href="#readingFnAttributes">readingFnAttributes</a></li>
  </ul>
  <br>

</ul>

=end html_DE

=cut
