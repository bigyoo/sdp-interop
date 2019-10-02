const Interop = require('../').Interop;
const fs = require('fs');
const Simulcast = require('@jitsi/sdp-simulcast');
const jsdiff = require('diff');
const colors = require('colors');
var transform = require('sdp-transform');
var deepEqual = require('deep-equal');
var deepDiff = require('deep-diff');
const RtxModifier = require('../build/xmpp/RtxModifier');
const SdpTransformWrap = require ('../build/xmpp/SdpTransformUtil').SdpTransformWrap;

const BASE_PATH_OF_SAFARI_SDP_FOLDER = 'test/safari/';
const SIMULCAST_LAYERS = 3;
const SIM_LAYER_1_RID = '1';
const SIM_LAYER_2_RID = '2';
const SIM_LAYER_3_RID = '3';
const SIM_LAYER_RIDS = [ SIM_LAYER_1_RID, SIM_LAYER_2_RID, SIM_LAYER_3_RID ];

const simulcast = new Simulcast({ numOfLayers: SIMULCAST_LAYERS, explodeRemoteSimulcast: false });


if (typeof QUnit == 'undefined') {
  QUnit = require('qunit-cli');
  QUnit.load();

  interop = require('..');
};

global.RTCSessionDescription = function (desc) {
  this.type = desc.type;
  this.sdp = desc.sdp;
}

global.RTCIceCandidate = function (cand) {
  this.candidate = cand.candidate;
  this.sdpMLineIndex = cand.sdpMLineIndex;
  this.sdpMid = cand.sdpMid;
}

var dumpSDP = function (description) {
  if (typeof description === 'undefined' || description === null) {
    return '-';
  }
  return 'type: ' + description.type + '\r\n' + description.sdp;
};

var unbackslash = function (s) {
    return s.replace(/\\([\\rnt'"])/g, function(match, p1) {
        if (p1 === 'n') return '\n';
        if (p1 === 'r') return '\r';
        if (p1 === 't') return '\t';
        if (p1 === '\\') return '\\';
        return p1;       // unrecognised escape
    });
}



// -------------------------------------------------------------------------------------
// ~ Tests
// -------------------------------------------------------------------------------------


QUnit.test('audioInactiveUnifiedPlan2PlanB', function (assert) {
	/*jshint multistr: true */
	var originUnifiedPlan = fs.readFileSync('test/test-resources/unified-plan.txt', 'utf8');

	/*jshint multistr: true */
	var expectedPlanB = fs.readFileSync('test/test-resources/expected-plan-b.txt', 'utf8');

	var interop = new Interop();

	var answer = new RTCSessionDescription({
		type: 'answer',
		sdp: originUnifiedPlan
	});

	var planBDesc = interop.toPlanB(answer);

	assert.equal(unbackslash(planBDesc.sdp), unbackslash(expectedPlanB),
		"Not expected Plan B output");
});

QUnit.test('01-planb-offer-from-jvb-conversion-to-unified-plan', function(assert) {

	const interop = new Interop();
	const rtxModifier = new RtxModifier.default();

	// ------------------------------------------------------------------------------------------
	// ~~~ Offer from JVB
	// ------------------------------------------------------------------------------------------

	// read SDP offer that was coming from JVB
	const offerPlanb = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '01-offer-from-jvb.txt', 'utf8');
	var offerRTCSessionDesc = new RTCSessionDescription({
		type: 'offer',
		sdp: offerPlanb
	});
	setOfferAsRemoteDesciption(assert, interop, rtxModifier, offerRTCSessionDesc);

	// ------------------------------------------------------------------------------------------
	// ~~~ Caching unified plan offer
	// ------------------------------------------------------------------------------------------

	// we pretend that the offer was stored and slightly manipulazted by the safari bowser
	offerRTCSessionDesc.sdp = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '06-offer-as-stored-by-browser.txt', 'utf8');
	
	// this will cache the current sdp which is unified plan now and totaly acceptable by safari
	const planbOfferConvertedBackFromUnified = interop.toPlanB(offerRTCSessionDesc);
	assertAfterTransformingBackTheOfferToPlanb(assert, planbOfferConvertedBackFromUnified.sdp);

	// ------------------------------------------------------------------------------------------
	// ~~~ Creating answer
	// ------------------------------------------------------------------------------------------
	const answerSdpGeneratedBySafari = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '08-answer-generated-by-safari-unified.txt', 'utf8');
	var answerRTCSEssionDesc = new RTCSessionDescription({
		type: 'answer',
		sdp: answerSdpGeneratedBySafari
	});

	// apply planB transformation
	answerRTCSEssionDesc = interop.toPlanB(answerRTCSEssionDesc);
	// apply simcast transformation
	answerRTCSEssionDesc = _injectSsrcGroupForUnifiedSimulcast(answerRTCSEssionDesc);
	// apply munge transformation
	answerRTCSEssionDesc = simulcast.mungeLocalDescription(answerRTCSEssionDesc);
	assertAnswerAfterEveryTransformationApplied(assert, answerRTCSEssionDesc.sdp, '09-answer-after-every-transformation-applied.txt');
	
	// --------------------------------------------------------------------------------------------
	// ~~~ SetLocalDescription
	// --------------------------------------------------------------------------------------------
	
	answerRTCSEssionDesc = _adjustLocalMediaDirection(answerRTCSEssionDesc);
	answerRTCSEssionDesc = _ensureSimulcastGroupIsLast(answerRTCSEssionDesc);
	answerRTCSEssionDesc = interop.toUnifiedPlan(answerRTCSEssionDesc);
	assertAnswerBeforeSettingLocalDesc(assert, answerRTCSEssionDesc.sdp);
	
	// --------------------------------------------------------------------------------------------
	// ~~~ Renegotiation - setting new offer as remote desc
	// --------------------------------------------------------------------------------------------
	
	const newOfferPlanb = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '12-new-offer-from-jvb.txt', 'utf8');
	var newOfferRTCSessionDesc = new RTCSessionDescription({
		type: 'offer',
		sdp: newOfferPlanb
	});
	
	const newOfferUnified = renegotiation(assert, interop, rtxModifier,  newOfferRTCSessionDesc);
	
	// ------------------------------------------------------------------------------------------
	// ~~~ Renegotiation - creating answer
	// ------------------------------------------------------------------------------------------
	
	const newAnswerSdpGeneratedBySafari = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '13-new-answer-generated-by-safari-unified.txt', 'utf8');
	var newAnswerRTCSEssionDesc = new RTCSessionDescription({
		type: 'answer',
		sdp: newAnswerSdpGeneratedBySafari
	});
	
	// apply planB transformation
	newAnswerRTCSEssionDesc = interop.toPlanB(newAnswerRTCSEssionDesc);
	// apply simcast transformation
	newAnswerRTCSEssionDesc = _injectSsrcGroupForUnifiedSimulcast(newAnswerRTCSEssionDesc);
	// apply munge transformation
	newAnswerRTCSEssionDesc = simulcast.mungeLocalDescription(newAnswerRTCSEssionDesc);
	//assertAnswerAfterEveryTransformationApplied(assert, newAnswerRTCSEssionDesc.sdp, '14-new-answer-after-every-transformation-applied.txt');
	
	// ------------------------------------------------------------------------------------------
	// ~~~ Renegotiation - getRemoteDesc
	// ------------------------------------------------------------------------------------------
	interop.toPlanB(newOfferUnified);
	
	// ------------------------------------------------------------------------------------------
	// ~~~ Renegotiation - setLocalDesc
	// ------------------------------------------------------------------------------------------

	interop.toUnifiedPlan(newAnswerRTCSEssionDesc);

});

var setOfferAsRemoteDesciption = function(assert, interop, rtxModifier, offerRTCSessionDesc) {
	// apply munge transformation
	offerRTCSessionDesc = simulcast.mungeRemoteDescription(offerRTCSessionDesc);
		assertAfterMunged(assert, offerRTCSessionDesc.sdp);
	
		// apply stripRtx transformation
		
		offerRTCSessionDesc.sdp = rtxModifier.stripRtx(offerRTCSessionDesc.sdp);
		assertAfterRtxModification(assert, offerRTCSessionDesc.sdp);
	
		// apply unified plan transformation
		offerRTCSessionDesc = interop.toUnifiedPlan(offerRTCSessionDesc);
		assertAfterUnifiedPlanTransformation(assert, offerRTCSessionDesc.sdp);
	
		// apply simulcast transformation
		offerRTCSessionDesc = _insertUnifiedPlanSimulcastReceive(offerRTCSessionDesc);
		assertAfterSimulcastTransformation(assert, offerRTCSessionDesc.sdp);
}

var renegotiation = function(assert, interop, rtxModifier, offerRTCSessionDesc) {

	// apply munge transformation
	offerRTCSessionDesc = simulcast.mungeRemoteDescription(offerRTCSessionDesc);

	// apply stripRtx transformation
	offerRTCSessionDesc.sdp = rtxModifier.stripRtx(offerRTCSessionDesc.sdp);

	// apply unified plan transformation
	offerRTCSessionDesc = interop.toUnifiedPlan(offerRTCSessionDesc);

	// apply simulcast transformation
	offerRTCSessionDesc = _insertUnifiedPlanSimulcastReceive(offerRTCSessionDesc);

	return offerRTCSessionDesc;
}

var assertAfterMunged = function(assert, actualSdp) {
	console.log('> Checking after munged.');
	
	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '02-post-tranform-simulcast.txt', 'utf8');
	assert.equal(expected.trim(), actualSdp.trim());
}

var assertAfterRtxModification = function(assert, actualSdp) {
	console.log('> Checking after rtx modification.');

	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '03-post-transform-stripRtx.txt', 'utf8');
	assert.equal(expected.trim(), actualSdp.trim());
}

var assertAfterUnifiedPlanTransformation = function(assert, actualSdp) {
	console.log('> Checking after unified plan transformation');

	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '04-post-unified-plan-transformation.txt', 'utf8');
	assert.equal(expected.trim(), actualSdp.trim());
}

var assertAfterSimulcastTransformation = function(assert, actualSdp) {
	console.log('> Checking after simcast transformation');

	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '05-post-simulcast-transformation.txt', 'utf8');
	assert.equal(expected.trim(), actualSdp.trim());
}

var assertAfterTransformingBackTheOfferToPlanb = function(assert, actualSdp) {
	console.log('> Checking after Transforming Back The Offer To Planb');
	
	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '07-offer-tranformed-back-to-planb-after-stored-by-safari.txt', 'utf8');
	assert.equal(expected.trim(), actualSdp.trim());
}

var assertAnswerAfterEveryTransformationApplied = function(assert, actualSdp, expectedResultFileName) {
	console.log('> Checking answer after every Transformation applied');
	
	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + expectedResultFileName, 'utf8');
	assert.equal(actualSdp.trim(), expected.trim());
}

var assertAnswerBeforeSettingLocalDesc = function(assert, actualSdp) {
	console.log('> Checking answer Before Setting Local Desc');
	
	// read expected result
	const expected = fs.readFileSync(BASE_PATH_OF_SAFARI_SDP_FOLDER + '11-answer-from-app-converted-to-unified-for-setting-local-desc.txt', 'utf8');
	assert.equal(expected.trim(), actualSdp.trim());
}

var _insertUnifiedPlanSimulcastReceive = function(desc) {
	const sdp = transform.parse(desc.sdp);
	const video = sdp.media.find(mline => mline.type === 'video');

	// In order of lowest to highest spatial quality
	video.rids = [
		{
			id: SIM_LAYER_1_RID,
			direction: 'recv'
		},
		{
			id: SIM_LAYER_2_RID,
			direction: 'recv'
		},
		{
			id: SIM_LAYER_3_RID,
			direction: 'recv'
		}
	];
	// eslint-disable-next-line camelcase
	video.simulcast_03 = {
		value: `recv rid=${SIM_LAYER_RIDS.join(';')}`
	};

	return new RTCSessionDescription({
		type: desc.type,
		sdp: transform.write(sdp)
	});
};

var _injectSsrcGroupForUnifiedSimulcast = function(desc) {
	const sdp = transform.parse(desc.sdp);
	const video = sdp.media.find(mline => mline.type === 'video');

	if (video.simulcast_03) {
		const ssrcs = [];

		video.ssrcs.forEach(ssrc => {
			if (ssrc.attribute === 'msid') {
				ssrcs.push(ssrc.id);
			}
		});
		video.ssrcGroups = video.ssrcGroups || [];
		if (video.ssrcGroups.find(group => group.semantics === 'SIM')) {
			// Group already exists, no need to do anything
			return desc;
		}
		video.ssrcGroups.push({
			semantics: 'SIM',
			ssrcs: ssrcs.join(' ')
		});
	}

	return new RTCSessionDescription({
		type: desc.type,
		sdp: transform.write(sdp)
	});
};

var _adjustLocalMediaDirection = function(
	localDescription) {
const transformer = new SdpTransformWrap(localDescription.sdp);
let modifiedDirection = false;
const audioMedia = transformer.selectMedia('audio');

if (audioMedia) {
	const desiredAudioDirection
		= _getDesiredMediaDirection('audio');

	if (audioMedia.direction !== desiredAudioDirection) {
		audioMedia.direction = desiredAudioDirection;
		modifiedDirection = true;
	}
} else {
	console.log('No "audio" media found int the local description');
}

const videoMedia = transformer.selectMedia('video');

if (videoMedia) {
	const desiredVideoDirection
		= _getDesiredMediaDirection('video');

	if (videoMedia.direction !== desiredVideoDirection) {
		videoMedia.direction = desiredVideoDirection;
		console.log(
			`Adjusted local video direction to ${desiredVideoDirection}`);
		modifiedDirection = true;
	}
} else {
	console.log('No "video" media found in the local description');
}

if (modifiedDirection) {
	return new RTCSessionDescription({
		type: localDescription.type,
		sdp: transformer.toRawSDP()
	});
}

return localDescription;
};

var _ensureSimulcastGroupIsLast = function(
	localSdp) {
let sdpStr = localSdp.sdp;

const videoStartIndex = sdpStr.indexOf('m=video');
const simStartIndex = sdpStr.indexOf('a=ssrc-group:SIM', videoStartIndex);
let otherStartIndex = sdpStr.lastIndexOf('a=ssrc-group');

if (simStartIndex === -1
	|| otherStartIndex === -1
	|| otherStartIndex === simStartIndex) {
	return localSdp;
}

const simEndIndex = sdpStr.indexOf('\r\n', simStartIndex);
const simStr = sdpStr.substring(simStartIndex, simEndIndex + 2);

sdpStr = sdpStr.replace(simStr, '');
otherStartIndex = sdpStr.lastIndexOf('a=ssrc-group');
const otherEndIndex = sdpStr.indexOf('\r\n', otherStartIndex);
const sdpHead = sdpStr.slice(0, otherEndIndex);
const simStrTrimmed = simStr.trim();
const sdpTail = sdpStr.slice(otherEndIndex);

sdpStr = `${sdpHead}\r\n${simStrTrimmed}${sdpTail}`;

return new RTCSessionDescription({
	type: localSdp.type,
	sdp: sdpStr
});
};

var _getDesiredMediaDirection = function(mediaType) {
	/*let mediaTransferActive = true;

	if (mediaType === 'audio') {
		mediaTransferActive = this.audioTransferActive;
	} else if (mediaType === 'video') {
		mediaTransferActive = this.videoTransferActive;
	}
	if (mediaTransferActive) {
		return hasAnyTracksOfType(mediaType) ? 'sendrecv' : 'recvonly';
	}*/

	return 'sendrecv';
};
