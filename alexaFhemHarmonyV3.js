'use strict';

const FHEM_BASE = process.env.FHEM_BASE || '/fhem/?XHR=1&cmd=';
const FHEM_HOST = process.env.FHEM_HOST;
const FHEM_PORT = process.env.FHEM_PORT || 443;
const FHEM_USER = process.env.FHEM_USER || 'alexa';
const FHEM_PASS = process.env.FHEM_PASS;

// ------------------------------------------------- connection to home

function Request( event, callback )
{
	this.event = event;
	this._callback = callback;
	this._response = 
	{
		header:
		{
			namespace: event.directive.header.namespace,
			name: event.directive.header.name + ".Response",
			payloadVersion: "3",
			messageId: generateUuid()
		},
		payload: {}
	};
	if ( event.directive.header.correlationToken )
		this._response.header.correlationToken = event.directive.header.correlationToken;

	this.send = ( context ) => 
	{ 
		console.log( this._response );
		if ( context )
			console.log( context );
		this._callback( null, context ? { context, event: this._response } 
		                              : { event: this._response } );
	};
	
	this.respond = ( context ) =>
	{
		if ( this.event.directive.endpoint )
			this._response.endpoint = { endpointId: this.event.directive.endpoint.endpointId };
		this.send( context );
	};

	this.errorResponse = ( type, message ) =>
	{
		this._response.payload = { type, message };
		this.respond();
	};
	
	this.fhemReq = ( cmd, reqCallback ) =>
	{
		if ( !this._https )
			this._https = require('https');

		var self = this;
		console.log( "fhemReq: " + FHEM_BASE + cmd );
		this._https.get( 
				{
					hostname: FHEM_HOST,
					port:     FHEM_PORT,
					path:     FHEM_BASE + encodeURIComponent( cmd ),
					//rejectUnauthorized: false,
					headers:  { accept: '*/*' },
					auth:     FHEM_USER + ':' + FHEM_PASS
				},
				( response ) =>
				{
					var str = '';
					response.on( 'data', ( chunk ) => { str += chunk.toString('utf-8'); });
					response.on( 'end', () => 
							{
								console.log( "fhem: " + ( str || 'no answere' ) );
								reqCallback( str ? ( response.headers['content-type'] == 'application/json; charset=utf-8' ? JSON.parse( str ) : str ) 
								                 : { } ); 
							} );
					response.on( 'error', ( e ) => { self.errorResponse( "BRIDGE_UNREACHABLE", "Kommunikationsfehler " + e ); } );
				}
			).on( 'error', ( e ) => { self.errorResponse( "INTERNAL_ERROR", "HTTPS error " + e ); } ).end();
	};
}


// --------------- Functions that control the skill's behaviour -----------------------

/**
 * Alexa.Discovery::Discover
 */
function handleDiscovery( request )
{
	if ( request.event.directive.header.name != 'Discover' )
		return request.errorResponse( 'INVALID_DIRECTIVE', 'Only Discover in namespace Alexa.Discovery is supported' );

	request.fhemReq( 'jsonlist2 EchoCap=harmony EchoDesc',
			( result ) =>
			{
				if ( !result || ! result.Results || !result.Results.length )
					return request.errorResponse( "BRIDGE_UNREACHABLE", "Keine Antwort vom Server" );
				let devices = [];
				let getScenes = '';
				for ( let dev of result.Results )
				{
					devices.push( { name: dev.Name, desc: dev.Attributes.EchoDesc } );
					getScenes += ',' + dev.Name;
				}

				request.fhemReq( 'get ' + getScenes.substr(1) + ' activities',
						( result ) =>
						{
							let endpoints = request._response.payload.endpoints = [];
							let scenes = result.split(/\n/);
							let i = 0; // device counter
							for ( let sceneStr of scenes )
							{
								let scene = sceneStr.match( /^(-?\d+)\t([^ ]+)/ );
								if ( !scene || !scene[2] )
								{
									console.log( "Format error", sceneStr );
									continue;
								}
								if ( scene[1] == '-1' )
								{
									if ( ++i >= devices.length )
										break;
									continue;
								}
								let name = scene[2];
								endpoints.push(
								{
									endpointId: 'hs' + scene[1],
									friendlyName: name,
									description: name + " " + devices[i].desc,
									manufacturerName: 'FHEM harmony',
									displayCategories: [ "ACTIVITY_TRIGGER" ],
									cookie: { dev: devices[i].name, scene: scene[1] },
									capabilities: [ {
									  type: "AlexaInterface",
									  interface: "Alexa.SceneController",
									  version : "3",
									  supportsDeactivation : true,
									  proactivelyReported : false
									} ],
								} );
							}
							request.send();
						} );
			} );
}


/**
 * Alexa.SceneController::*
 */
function controlRequest( request )
{
	let dev = request.event.directive.endpoint.cookie.dev;
	if ( !dev )
		throw ( 'no device in cookies' );
	let targetState = request.event.directive.header.name == 'Activate';
	request.fhemReq( 'set ' + dev + ( targetState ? ' activity ' + request.event.directive.endpoint.cookie.scene
	                                              : ' off' ),
			( result ) =>
			{
				request._response.header.name = targetState ? 'ActivationStarted' : 'DeactivationStarted';
				request._response.payload = {
					cause: { type: 'VOICE_INTERACTION' },
					timestamp: new Date()
				};
				request.send( {} ); // send with context
			} );
}

// --------------- Main handler -----------------------
exports.handler = ( event, context, callback ) => {
	try
	{
		var request = new Request( event, callback );

		console.log(event.directive);

		switch ( event.directive.header.namespace )
		{
			case 'Alexa.Discovery': return handleDiscovery( request );

			case 'Alexa':
				switch ( event.directive.header.name )
				{
					case 'ReportState':
						request._response.header.name = "StateReport";
						return request.respond( { } );
				}
				return request.errorResponse( 'INVALID_DIRECTIVE', 'ReportState expected' );

			case 'Alexa.SceneController':
				return controlRequest( request );

			default:
				return request.errorResponse( 'INVALID_DIRECTIVE', 
				                              'Not supported: ' + event.directive.header.namespace 
											  + '::' + event.directive.header.name );
		}
	} catch (err)
	{
		console.log(err.stack);
		request.errorResponse( 'INTERNAL_ERROR', 'Exception: ' + err );
	}
};

function generateUuid()
{
	var totalCharacters = 39; // length of number hash; in this case 0-39 = 40 characters
	var txtUuid = "";
	do {
		var point = Math.floor(Math.random() * 10);
		if (txtUuid.length === 0 && point === 0) {
			do {
				point = Math.floor(Math.random() * 10);
			} while (point === 0);
		}
		txtUuid = txtUuid + point;
	} while ((txtUuid.length - 1) < totalCharacters);
	return txtUuid;
}
