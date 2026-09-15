import {Pulse} from '@pulse-compute/pulse'
import first from './first'
import other from './other'
const app=new Pulse({auto:true});app.post('/first',first);app.post('/other',other);export default app
