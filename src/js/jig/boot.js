// jig entry — mount the builder via the surface contract (mount(ctx) → dispose).
// Standalone surface: output leaves via download / capsule-share (the collector's
// existing intake), so no record store and no service worker here (the collector
// owns persistence + the SW; jig is a stateless authoring surface). Dropped into
// the collector as a tab, the host passes ctx.onEmit to route the built tree into
// store.putForm instead.

import { mountJig } from './ui.js';
import { bootSurface } from '../surface/contract.js';

bootSurface(({ root }) => mountJig({ root }), { label: 'jig' });
