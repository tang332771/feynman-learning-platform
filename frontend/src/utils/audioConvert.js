// convertBlobToWav16kMono(blob)
// Decodes audio blob, resamples to 16kHz mono using OfflineAudioContext if needed,
// then encodes to 16-bit PCM WAV and returns a Blob suitable for ASR.
export async function convertBlobToWav16kMono(blob) {
  if (!blob) throw new Error('blob required');
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await new Promise((resolve, reject) => {
    audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
  });

  const targetRate = 16000;
  const numberOfChannels = 1;

  let renderedBuffer = decoded;
  if (decoded.sampleRate !== targetRate || decoded.numberOfChannels !== numberOfChannels) {
    const lengthInSamples = Math.ceil(decoded.duration * targetRate);
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      numberOfChannels,
      lengthInSamples,
      targetRate
    );

    const bufferSource = offlineCtx.createBufferSource();
    // copy channels into offline buffer (keeps original channels then offlineCtx resamples)
    const ctxBuffer = offlineCtx.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      ctxBuffer.getChannelData(ch).set(decoded.getChannelData(ch));
    }

    bufferSource.buffer = ctxBuffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start(0);
    renderedBuffer = await offlineCtx.startRendering();
  }

  // mix to mono if needed
  let mono;
  if (renderedBuffer.numberOfChannels === 1) {
    mono = renderedBuffer.getChannelData(0);
  } else {
    const len = renderedBuffer.length;
    mono = new Float32Array(len);
    for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
      const chData = renderedBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) mono[i] += chData[i] / renderedBuffer.numberOfChannels;
    }
  }

  const wavView = encodeWAV(mono, targetRate);
  return new Blob([wavView], { type: 'audio/wav' });
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);
  return view;
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    output.setInt16(offset, s, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}
