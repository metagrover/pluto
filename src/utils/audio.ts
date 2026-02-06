
export function createWavBlob(samples: Float32Array, sampleRate: number = 48000, numChannels: number = 2): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 4);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * 4, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* fmt chunk identifier */
    writeString(view, 12, 'fmt ');
    /* fmt chunk length */
    view.setUint32(16, 16, true);
    /* sample format (float) */
    view.setUint16(20, 3, true);
    /* channel count */
    view.setUint16(22, numChannels, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sampleRate * blockAlign) */
    view.setUint32(28, sampleRate * 4 * numChannels, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, numChannels * 4, true);
    /* bits per sample */
    view.setUint16(34, 32, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 4, true);

    // Write float data
    const floatView = new Float32Array(buffer, 44);
    floatView.set(samples);

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

export function computeRms(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
}

export async function playSoftBootTone(opts?: {
    durationMs?: number
    frequency?: number
    volume?: number
}): Promise<void> {
    const durationMs = opts?.durationMs ?? 800
    const frequency = opts?.frequency ?? 440
    const volume = opts?.volume ?? 0.02

    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        if (ctx.state === 'suspended') await ctx.resume()

        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = frequency

        const gain = ctx.createGain()
        gain.gain.value = 0

        osc.connect(gain)
        gain.connect(ctx.destination)

        const now = ctx.currentTime
        const attack = 0.02
        const release = 0.08
        const hold = Math.max(0, durationMs / 1000 - (attack + release))
        gain.gain.linearRampToValueAtTime(volume, now + attack)
        gain.gain.setValueAtTime(volume, now + attack + hold)
        gain.gain.linearRampToValueAtTime(0.0001, now + attack + hold + release)

        osc.start()
        osc.stop(now + attack + hold + release)

        await new Promise<void>((resolve) => {
            osc.onended = () => resolve()
        })

        await ctx.close()
    } catch {
        // best-effort; ignore failures (autoplay, device state, etc.)
    }
}
