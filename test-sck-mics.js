import { microphoneDevices } from 'screencapturekit';

microphoneDevices().then(d => {
    console.log('Mics:', JSON.stringify(d, null, 2));
}).catch(e => console.error(e));
