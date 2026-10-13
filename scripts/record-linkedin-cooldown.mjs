#!/usr/bin/env node
// Skills call this after an observed 429; an optional argument is Retry-After.
import { workDir } from '../engine/config.mjs';
import { recordLinkedInCooldown } from '../engine/linkedin-cooldown.mjs';
console.log(JSON.stringify(recordLinkedInCooldown({ work: workDir(), retryAfter: process.argv[2], workflow: 'enrichment-skill' })));
