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
					response.on( 'data',
					             ( chunk ) => { str += chunk.toString('utf-8');
					                          }
					           );
					response.on( 'end', () =>
							{
								console.log( "fhem: " + ( str || 'no answere' ) );
								reqCallback( str ? JSON.parse( str ) : { } );
							} );
					response.on( 'error',
					             ( e ) => { self.errorResponse( "BRIDGE_UNREACHABLE",
					                                            "Kommunikationsfehler " + e
					                                          );
					                      } );
				}
			).on( 'error',
			      ( e ) => { self.errorResponse( "INTERNAL_ERROR",
			                                     "HTTPS error " + e
			                                   );
			      	       }
			    ).end();
	};
}


// --------------- Functions that control the skill's behavior -----------------------

var capCategoryMap =
{
	heating: 'THERMOSTAT',
	temp:    'THERMOSTAT',
	window:  'SMARTLOCK',
	power:   'SWITCH',
	color:   'LIGHT',
	bri:     'LIGHT',
	volume:  'SPEAKER'
};
var capabilitiesMap =
{
	power:
	{
		type: "AlexaInterface",
		interface: "Alexa.PowerController",
		version: "3",
		properties:
		{
			"supported": [ { name: "powerState" } ],
			proactivelyReported: false,
			retrievable: true
		}
	},
	color:
	{
		type: "AlexaInterface",
		interface: "Alexa.ColorController",
		version: "3",
		properties:
		{
			"supported": [ { name: "color" } ],
			proactivelyReported: false,
			retrievable: true
		}
	},
	bri:
	{
		type: "AlexaInterface",
		interface: "Alexa.BrightnessController",
		version: "3",
		properties:
		{
			"supported": [ { name: "brightness" } ],
			proactivelyReported: false,
			retrievable: true
		}
	},
	heating:
	{
		type: "AlexaInterface",
		interface: "Alexa.ThermostatController",
		version: "3",
		properties:
		{
			supported:
			[
				{
					name: "targetSetpoint"
				},
				{
					name: "thermostatMode"
				}
			],
			proactivelyReported: false,
			retrievable: true
		}
	},
	temp:
	{
		type: "AlexaInterface",
		interface: "Alexa.TemperatureSensor",
		version: "3",
		properties:
		{
			supported: [ { name: "temperature" } ],
			proactivelyReported: false,
			retrievable: true
		}
	},
	volume:
	{
		type: "AlexaInterface",
		interface: "Alexa.Speaker",
		version: "3",
		properties:
		{
			supported: [ { name: "volume" }, { name: "muted" } ],
			proactivelyReported: false,
			retrievable: true
		}
	},
	contact:
	{
		type: "AlexaInterface",
		interface: "Alexa.ContactSensor",
		version: "3",
		properties:
		{
			"supported": [ { name: "detectionState" } ],
			proactivelyReported: false,
			retrievable: true
		}
	},
	motion:
	{
		type: "AlexaInterface",
		interface: "Alexa.MotionSensor",
		version: "3",
		properties:
		{
			"supported": [ { name: "detectionState" } ],
			proactivelyReported: true,
			retrievable: true
		}
	},
	window:
	{
		type: "AlexaInterface",
		interface: "Alexa.LockController",
		version: "3",
		properties:
		{
			"supported": [ { name: "lockState" } ],
			proactivelyReported: false,
			retrievable: true
		}
	}
};

var stateReqMap =
{
	power:
	[
		{ STATE: true },
		( dev, res ) =>
		{
			let reading = dev.Internals;
			if ( !reading ) return;
			res.push(
					{
						namespace: "Alexa.PowerController",
						name: "powerState",
						value: reading.STATE == "off" ? "OFF" : "ON",
						timeOfSample: new Date(),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	color:
	[
		{ brightness: true, hue: true, saturation: true },
		( dev, res ) =>
		{
			let readings = dev.Readings;
			if ( !readings ) return;
			if ( readings.brightness )
				res.push(
						{
							namespace: "Alexa.ColorController",
							name: "color",
							value:
							{
								hue: readings.hue.Value,
								saturation: readings.saturation.Value / 100,
								brightness: readings.brightness.Value / 100
							},
							timeOfSample: new Date( Date.parse( readings.hue.Time ) ),
							uncertaintyInMilliseconds: 1000
						} );
		}
	],
	bri:
	[
		{ brightness: true },
		( dev, res ) =>
		{
			let reading = dev.Readings.brightness;
			if ( !reading ) return;
			res.push(
					{
						namespace: "Alexa.BrightnessController",
						name: "brightness",
						value: reading.Value,
						timeOfSample: new Date( Date.parse( reading.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	heating:
	[
		{ desiredTemperature: true, mode: true },
		( dev, res ) =>
		{
			let tempReading = dev.Readings.desiredTemperature;
			if ( !tempReading )
				return;
			let temp = tempReading.Value;
			if ( temp == 'off' )
				return res.push(
						{
							namespace: "Alexa.ThermostatController",
							name: "thermostatMode",
							value: 'OFF',
							timeOfSample: new Date( Date.parse( tempReading.Time ) ),
							uncertaintyInMilliseconds: 1000
						} );
			res.push(
					{
						namespace: "Alexa.ThermostatController",
						name: "targetSetpoint",
						value: { value: parseFloat(temp), scale: "CELSIUS" },
						timeOfSample: new Date( Date.parse( tempReading.Time ) ),
						uncertaintyInMilliseconds: 1000
					},
					{
						namespace: "Alexa.ThermostatController",
						name: "thermostatMode",
						value: ({ manual: "HEAT", auto: "AUTO" })[ dev.Readings.mode.Value ],
						timeOfSample: new Date( Date.parse( dev.Readings.mode.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	temp:
	[
		{ temperature: true },
		( dev, res ) =>
		{
			let reading = dev.Readings.temperature;
			if ( !reading ) return;
			res.push(
					{
						namespace: "Alexa.TemperatureSensor",
						name: "temperature",
						value: { value: parseFloat(reading.Value), scale: "CELSIUS" },
						timeOfSample: new Date( Date.parse( reading.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	volume:
	[
		{ volume: true, mute: true },
		( dev, res ) =>
		{
			let volume = dev.Readings.volume;
			let mute   = dev.Readings.mute;
			res.push(
					{
						namespace: "Alexa.Speaker",
						name: "volume",
						value: parseFloat( volume.Value ),
						timeOfSample: new Date( Date.parse( volume.Time ) ),
						uncertaintyInMilliseconds: 1000
					}, {
						namespace: "Alexa.Speaker",
						name: "muted",
						value: mute.Value == 'on',
						timeOfSample: new Date( Date.parse( mute.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	contact:
	[
		{ state: true },
		( dev, res ) =>
		{
			let reading = dev.Readings.state;
			if ( !reading ) return;
			res.push(
					{
						namespace: "Alexa.ContactSensor",
						name: "detectionState",
						value: reading.Value == "closed" ? "DETECTED" : "NOT_DETECTED",
						timeOfSample: new Date( Date.parse( reading.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	motion:
	[
		{ state: true },
		( dev, res ) =>
		{
			let reading = dev.Readings.state;
			if ( !reading ) return;
			res.push(
					{
						namespace: "Alexa.MotionSensor",
						name: "detectionState",
						value: reading.Value == "on" ? "DETECTED" : "NOT_DETECTED",
						timeOfSample: new Date( Date.parse( reading.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	],
	window:
	[
		{ state: true },
		( dev, res ) =>
		{
			let reading = dev.Readings.state;
			if ( !reading ) return;
			res.push(
					{
						namespace: "Alexa.LockController",
						name: "lockState",
						value: reading.Value == "closed" ? "LOCKED" : "UNLOCKED",
						timeOfSample: new Date( Date.parse( reading.Time ) ),
						uncertaintyInMilliseconds: 1000
					} );
		}
	]
};

/**
 * Alexa.Discovery::Discover
 */
function handleDiscovery( request )
{
	if ( request.event.directive.header.name != 'Discover' )
		return request.errorResponse( 'INVALID_DIRECTIVE',
		                              'Only Discover in namespace Alexa.Discovery is supported' );

	request.fhemReq( 'jsonlist2 EchoWord=..* EchoWord EchoCap EchoDesc EchoCat',
			( result ) =>
			{
				if ( !result || ! result.Results || !result.Results.length )
					return request.errorResponse( "BRIDGE_UNREACHABLE",
					                              "Keine Antwort vom Server" );
				let defRef = {};
				let endpoints = request._response.payload.endpoints = [];
				for ( let dev of result.Results )
				{
					let friendlyName = dev.Attributes.EchoWord;
					let devSpec = defRef[friendlyName];
					let category = dev.Attributes.Echocat;
					if ( !devSpec )
					{
						devSpec = defRef[friendlyName] =
						{
							friendlyName,
							endpointId: friendlyName.replace(/[^a-zA-Z0-9]/g,'_'),
							description: dev.Attributes.EchoDesc || friendlyName,
							manufacturerName: 'FHEM generic',
							cookie: {},
							capabilities: [],
						};
						endpoints.push( devSpec );
					}
					for ( let cap of dev.Attributes.EchoCap.split(' ') )
					{
						let devName = dev.Name;
						let colon = cap.indexOf( ':' );
						if ( colon > 0 )
						{
							devName = cap.substr( colon + 1 );
							cap = cap.substr( 0, colon );
						}
						devSpec.cookie[cap] = devName;
						if ( !category && capCategoryMap[cap] )
							category = capCategoryMap[cap];

						let value = capabilitiesMap[cap];
						if ( value )
							devSpec.capabilities.push( value );
						else
							console.log( "unsupported capability: " + cap );
					}
					devSpec.displayCategories = [ category ];
				}
				request.send();
			} );
	return;
}

/**
 * Alexa::ReportState
 */
function handleStateRequest( request, headerName, setCmd, patch )
{
	var askFor   = {}; // { deviceName: [ handler, ... ] }
	var readings = {}; // { reading: true }
	//if ( !cookie )
	let cookie = request.event.directive.endpoint.cookie;
	request._response.header.name = headerName || "StateReport";
	for ( let cap in cookie )
	{
		let dev  = cookie[cap];      // device name
		let todo = stateReqMap[cap]; // [ required readings, handler ]

		if ( askFor[dev] )
			askFor[dev].push( todo[1] );
		else
			askFor[dev] = [ todo[1] ];

		Object.assign( readings, todo[0] );
	}
	request.fhemReq( (setCmd||'')
	                 + 'jsonlist2 '
	                 + Object.keys( askFor ).join( ',' )
	                 + ' ' + Object.keys( readings ).join( ' ' ),
			( result ) =>
			{
				if ( !result || ! result.Results || !result.Results.length )
					return request.errorResponse( "BRIDGE_UNREACHABLE",
					                              "Keine Antwort vom Server" );
				let context = { properties: [] };
				for ( let dev of result.Results )
					if ( askFor[dev.Name] )
						for ( let handler of askFor[dev.Name] )
							handler( dev, context.properties );
					else
						console.log( "Missing handler for " + dev.Name );
				if ( patch )
					patch( context );
				request.respond( context );
			} );
}

/**
 * Alexa.PowerController::*
 */
function setPowerState( request )
{
	let dev = request.event.directive.endpoint.cookie.power;
	if ( !dev )
		throw ( 'no power device in cookies' );
	let target = request.event.directive.header.name == 'TurnOn' ? 'on' : 'off';
	request._response.header.namespace = 'Alexa';
	handleStateRequest( request, 'Response', 'set ' + dev + ' ' + target + ';' );
}

/**
 * Alexa.Speaker::SetMute
 */
function setMute( request )
{
	let dev = request.event.directive.endpoint.cookie.volume;
	if ( !dev )
		throw ( 'no volume device in cookies' );
	let target = request.event.directive.payload.mute ? 'on' : 'off';
	request._response.header.namespace = 'Alexa';
	handleStateRequest( request, 'Response',
	                    'set ' + dev + ' mute ' + target + ';' );
}

/**
 * Alexa.Speaker::SetVolume
 */
function setVolume( request )
{
	let dev = request.event.directive.endpoint.cookie.volume;
	if ( !dev )
		throw ( 'no volume device in cookies' );
	let target = request.event.directive.payload.volume;
	request._response.header.namespace = 'Alexa';
	handleStateRequest( request, 'Response',
	                    'set ' + dev + ' volume ' + target + ';' );
}

/**
 * Alexa.Speaker::AdjustVolume
 */
function adjustVolume( request )
{
	let dev = request.event.directive.endpoint.cookie.volume;
	if ( !dev )
		throw ( 'no volume device in cookies' );
	let target = request.event.directive.payload.volume;
	// default (without specific delta) is 10 (which is way to much)
	if ( request.event.directive.payload.volumeDefault )
		target /= 5;
	request._response.header.namespace = 'Alexa';
	handleStateRequest( request, 'Response',
	                    'set ' + dev
	                      + ' volume {( ReadingsVal($DEV,"volume",0) + '
	                      + target + ' )};'
	                  );
}

/**
 * Alexa.ColorController::SetColor
 */
function setColor( request )
{
	let dev = request.event.directive.endpoint.cookie.color;
	if ( !dev )
		throw ( 'no color device in cookies' );
	let target = request.event.directive.payload.color;
	request._response.header.namespace = 'Alexa';
	handleStateRequest( request,
						'Response',
	                    'set ' + dev + ' hsv ' + Math.round( target.hue ) + ','
								+ Math.round( target.saturation * 100 ) + ','
								+ Math.round( target.brightness * 100 ) + ';',
						( context ) => { for ( let prop of context.properties )
	                                        if ( prop.name == 'color' )
											{
												prop.value = target;
												prop.timeOfSample = new Date();
											}
										} );
}

/**
 * Alexa.BrightnessController::SetBrightness
 */
function setBrightness( request )
{
	let dev = request.event.directive.endpoint.cookie.bri;
	if ( !dev )
		throw ( 'no bri device in cookies' );
	let target = request.event.directive.payload.brightness;
	request._response.header.namespace = 'Alexa';
	handleStateRequest( request,
						'Response',
	                    'set ' + dev + ' dim ' + target + ';',
						( context ) => { for ( let prop of context.properties )
	                                        if ( prop.name == 'brightness' )
											{
												prop.value = target;
												prop.timeOfSample = new Date();
											}
										} );
}

/**
 * Alexa.ThermostatController::SetTargetTemperature
 */
function setTemperature( request )
{
	let dev = request.event.directive.endpoint.cookie.heating;
	if ( !dev )
		throw ( 'no heating device in cookies' );
	let target = request.event.directive.payload.targetSetpoint;
	request._response.header.namespace = 'Alexa';
	if ( !target || target.scale != 'CELSIUS' )
		return request.errorResponse( "TEMPERATURE_VALUE_OUT_OF_RANGE",
		                              "Currently only ° celsius is supported" );
	handleStateRequest( request,
						'Response',
	                    'set ' + dev + ' desiredTemperature ' + target.value + ';',
						( context ) => { for ( let prop of context.properties )
	                                        if ( prop.name == 'targetSetpoint' )
											{
												prop.value.value = target.value;
												prop.timeOfSample = new Date();
											}
										} );
}

/**
 * Alexa.ThermostatController::AdjustTargetTemperature
 */
function setDeltaTemperature( request )
{
	let dev = request.event.directive.endpoint.cookie.heating;
	if ( !dev )
		throw ( 'no heating device in cookies' );
	let target = request.event.directive.payload.targetSetpointDelta;
	request._response.header.namespace = 'Alexa';
	if ( !target || target.scale != 'CELSIUS' )
		return request.errorResponse( "TEMPERATURE_VALUE_OUT_OF_RANGE",
		                              "Currently only ° celsius is supported" );
	handleStateRequest( request,
						'Response',
						'set ' + dev
						  + " desiredTemperature {(ReadingsVal($DEV,'desiredTemperature','18')+ "
						  + target.value + ')};',
						( context ) => { for ( let prop of context.properties )
	                                        if ( prop.name == 'targetSetpoint' )
											{
												prop.value.value += target.value;
												prop.timeOfSample = new Date();
											}
										} );
}

/**
 * Alexa.ThermostatController::SetThermostatMode
 */
function setHeaterMode( request )
{
	let dev = request.event.directive.endpoint.cookie.heating;
	if ( !dev )
		throw ( 'no heating device in cookies' );
	request._response.header.namespace = 'Alexa';
	let setCmd = 'set ' + dev;
	switch ( request.event.directive.payload.thermostatMode.value )
	{
		case 'OFF':
			setCmd += ' desiredTemperature off;';
			 break;
		case 'AUTO':
			setCmd += ' desiredTemperature auto;';
			break;
		case 'HEAT':
			setCmd += ' desiredTemperature manual comfort;';
			break;
		case 'ECO':
			setCmd += ' desiredTemperature manual eco;';
			break;
		default:
			return request.errorResponse( "UNSUPPORTED_THERMOSTAT_MODE",
			                              "Only AUTO, ECO, HEAT and OFF supported" );
	}
	request.fhemReq( setCmd,
	                 ( result ) =>
	                 {
	                 	setTimeout( () =>
				                 	{
				                 		handleStateRequest( request, 'Response' );
				                 	},
				                 	2000 );

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
				if ( event.directive.header.name == 'ReportState' )
					return handleStateRequest( request );
				return request.errorResponse( 'INVALID_DIRECTIVE',
				                              'ReportState expected' );

			case 'Alexa.PowerController':
				return setPowerState( request );

			case 'Alexa.ColorController':
				if ( event.directive.header.name == 'SetColor' )
					return setColor( request );
				return request.errorResponse( 'INVALID_DIRECTIVE',
				                              'SetColor expected' );

			case 'Alexa.BrightnessController':
				if ( event.directive.header.name == 'SetBrightness' )
					return setBrightness( request );
				return request.errorResponse( 'INVALID_DIRECTIVE',
				                              'SetBrightness expected' );

			case 'Alexa.ThermostatController':
				switch ( event.directive.header.name )
				{
					case 'SetTargetTemperature':
						return setTemperature( request );
					case 'AdjustTargetTemperature':
						return setDeltaTemperature( request );
					case 'SetThermostatMode':
						return setHeaterMode( request );
				}
				return request.errorResponse( 'INVALID_DIRECTIVE',
				                              'unsupported in ThermostatController' );

			case 'Alexa.Speaker':
				switch ( event.directive.header.name )
				{
					case 'SetVolume':
						return setVolume( request );
					case 'AdjustVolume':
						return adjustVolume( request );
					case 'SetMute':
						return setMute( request );
				}
				return request.errorResponse( 'INVALID_DIRECTIVE',
				                              'unsupported in ThermostatController' );

			case 'Alexa.LockController':
				request._response.header.namespace = 'Alexa';
				return handleStateRequest( request, 'Response' );

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
