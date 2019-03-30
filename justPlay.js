'use strict';

// --------------- Helpers that build all of the responses -----------------------

function say( output, sessionAttributes )
{
    return {
        version: '1.0',
        sessionAttributes: sessionAttributes || {},
        response: {
            outputSpeech: {
                type: 'PlainText',
                text: output,
            },
            shouldEndSession: !sessionAttributes
        }
    };
}

function ask( output, repromptText, sessionAttributes )
{
    return {
        version: '1.0',
        sessionAttributes: sessionAttributes || {},
        response: {
            outputSpeech: {
                type: 'PlainText',
                text: output,
            },
            reprompt: {
                outputSpeech: {
                    type: 'PlainText',
                    text: repromptText,
                },
            },
            shouldEndSession: false
        }
    };
}

function mkResponse( sessionAttributes )
{
    return {
        version: '1.0',
        sessionAttributes: sessionAttributes || {},
        response: {
            outputSpeech: {},
            card: {},
            reprompt: {},
            directives: [],
            shouldEndSession: true
          }
    };
}

function stop( rsp )
{
    if ( !rsp )
        rsp = mkResponse();
    else if ( !rsp.response.directives )
        rsp.response.directives = [];

    rsp.response.directives.push(
        {
          type: "AudioPlayer.ClearQueue",
          clearBehavior : "CLEAR_ALL"
        } );
    return rsp;
}

function play( url, token, rsp )
{
    if ( !rsp )
        rsp = mkResponse();
    else if ( !rsp.response.directives )
        rsp.response.directives = [];

    rsp.response.directives.push(
        {
            type: "AudioPlayer.Play",
            playBehavior: "REPLACE_ALL",
            audioItem: {
              stream: {
                token,
                url,
                offsetInMilliseconds: 0
              }
            }
        } );
    return rsp;
}


// --------------- Main handler -----------------------
exports.handler = ( event, context, callback ) => {
    try
    {
        switch ( event.request.type )
        {
            case 'LaunchRequest':
                callback( null, play( process.env.URL, process.env.TOKEN, say( process.env.SAY ) ) );
                break;

            case 'IntentRequest':
				switch ( event.request.intent.name )
				{
					case 'AMAZON.ResumeIntent':
						callback( null, play( process.env.URL, process.env.TOKEN, say( process.env.SAY ) ) );
						break;

					case 'AMAZON.HelpIntent':
						callback( null, say( 'Ich kann ' + process.env.SAY + " wiedergeben", {} ) );
						break;

					case 'AMAZON.PauseIntent':
					case 'AMAZON.StopIntent': // stopp, hör endlich auf, aufhören
					case 'AMAZON.CancelIntent': // abbrechen
						callback( null, stop( say( 'Okay' ) ) );
						break;

					case 'AMAZON.NavigateHomeIntent':
						callback();
						break;

					default:
						callback( null, say( `Die Absicht ${event.request.intent.name} kenne ich leider nicht.` ) );
				}
                break;

            case 'AudioPlayer.PlaybackStarted':
            case 'SessionEndedRequest':
                callback();
                break;

            default:
                console.log( `Unexpeced request.type=${event.request.type}`, event.request );
                callback( null, say( `Den Anfrage Typ ${event.request.type} kenne ich leider nicht.` ) );
        }
    } catch (err) {
        callback(err);
    }
};
