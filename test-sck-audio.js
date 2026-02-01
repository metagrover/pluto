import { audioDevices } from 'screencapturekit';

audioDevices().then(d => {
    console.log('Audio Devices:', JSON.stringify(d, null, 2));
}).catch(e => console.error(e));
