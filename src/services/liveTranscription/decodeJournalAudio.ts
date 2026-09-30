/** Decode the recorder's PCM WAVs without a WebAudio device or capture stream. */
export async function decodeJournalAudio(data: Uint8Array): Promise<{
  samples: Float32Array;
  sampleRate: number;
}> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...data.subarray(offset, offset + 4));
  if (data.length >= 44 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    let format = 0;
    let channels = 0;
    let sampleRate = 0;
    let bits = 0;
    let pcmStart = 0;
    let pcmLength = 0;
    for (let offset = 12; offset + 8 <= data.length; ) {
      const length = view.getUint32(offset + 4, true);
      if (offset + 8 + length > data.length)
        throw new Error('journal_wav_invalid');
      if (tag(offset) === 'fmt ' && length >= 16) {
        format = view.getUint16(offset + 8, true);
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bits = view.getUint16(offset + 22, true);
      } else if (tag(offset) === 'data') {
        pcmStart = offset + 8;
        pcmLength = length;
      }
      offset += 8 + length + (length % 2);
    }
    if (
      !channels ||
      channels > 8 ||
      sampleRate < 8000 ||
      sampleRate > 192000 ||
      !pcmStart ||
      !((format === 1 && bits === 16) || (format === 3 && bits === 32)) ||
      pcmLength % ((channels * bits) / 8) !== 0
    )
      throw new Error('journal_wav_invalid');
    const samples = new Float32Array(pcmLength / ((channels * bits) / 8));
    for (let i = 0; i < samples.length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const offset = pcmStart + ((i * channels + channel) * bits) / 8;
        const value =
          format === 3
            ? view.getFloat32(offset, true)
            : view.getInt16(offset, true) / 32768;
        if (!Number.isFinite(value)) throw new Error('journal_wav_invalid');
        samples[i] += value / channels;
      }
    }
    return { samples, sampleRate };
  }
  // MediaRecorder fallback chunks include their initialization segment in the journal.
  const context = new OfflineAudioContext(1, 1, 16000);
  const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
  const samples = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const values = decoded.getChannelData(channel);
    for (let i = 0; i < samples.length; i++)
      samples[i] += values[i] / decoded.numberOfChannels;
  }
  return { samples, sampleRate: decoded.sampleRate };
}
