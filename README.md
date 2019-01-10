# alexa-fhem-lambda
Lambda functions used for alexa (smart home) connecting to fhem server

Following amazon aws lambda functions are intended to communicate directy with fhem server, so no extra server nor fhem module is needed.

## connection between amazon lambda and fhem

For a secure connection I use a apache forward proxy.

You need a hostname of your fhem server (or router into the internet). You can use dyndns or similar service.

Your internet router needs a rule to expose your fhem server on port 443 to the internet.

Following example is from an ubuntu server.
Enable required modules (hope I remember all):
```bash
  a2enmod proxy
  a2enmod proxy_http
  a2enmod ssl
```
Declare in your `/etc/apache2/sites-available/default-ssl.conf`:
```ApacheConf
  <VirtualHost _default_:443>
                ...
                SSLEngine on
                ...
                <Location />
                        AuthType Basic
                        AuthName "Restricted area"
                        AuthBasicProvider file
                        AuthUserFile /etc/apache2/htpasswd
                        Require user otherUsers
                </Location>
                <Location /fhem/>
                        Require user alexa otherUsers
                </Location>
                ProxyPass /fhem http://127.0.0.1:8085/fhem
                ProxyPassReverse /fhem http://127.0.0.1:8085/fhem
                ...
  </VirtualHost>
```
With `htpasswd -c /etc/apache2/htpasswd alexa` you can set the password used later.

I use letsencrypt, so the ssl connection can be verified. In most cases you can use a package belonging to your system. Be sure to have an ```letsencrypt renew``` weekly or so in your crontab.

## configure fhem

Add to the ```global``` device (you can ```list global``` and click global on third line in fhem web) to the attribute ```userattr```: ```EchoCap EchoCat EchoDesc EchoWord``` space separated.

### harmony
Add the attributes to your harmony device:
* EchoCap = harmony
* EchoDesc = Harmony in living room

## create lambda function

You need a amazon aws account. It is free when you use only lambda functions and to not exceed a usage limit. For personal use the limit should not be any problem. Best to configure some alarms, to be sure.

There a many pages how to create an amazon alexa smart home lambda. Follow these and put in the source instead of the given.
The function should work with the newest node.js version available (I've tested with 8.10).

To connect to fehm some configuration is required as environment variables (can be configured below the function source code):
* FHEM_HOST = your.dyndns.org
* FHEM_PASS = thePasswordYouChose
optional (if you've changed things in the configuration):
* FHEM_BASE = '/fhem/?XHR=1&cmd='
* FHEM_PORT = 443
* FHEM_USER = alexa

### Test
Test connectivity with:
```json
{
  "directive": {
    "header": {
      "namespace": "Alexa.Discovery",
      "name": "Discover",
      "payloadVersion": "3",
      "messageId": "abc-123-def-456"
    },
    "payload": {
      "scope": {
        "type": "BearerToken",
        "token": "access-token-from-skill"
      }
    }
  }
}
```

## create your alexa smart home skill
You'll find good walkthrougs in the net how to set up a alexa smart home skill. You need to set up a auth with amazon before.
