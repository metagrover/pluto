import { screens } from 'screencapturekit';

screens().then(s => {
    console.log('Screens:', JSON.stringify(s, null, 2));
}).catch(e => console.error(e));
