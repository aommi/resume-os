#!/usr/bin/env node
import { dispatchHandoffs } from '../engine/pipeline-handoff.mjs';
console.log(JSON.stringify(dispatchHandoffs(), null, 2));
