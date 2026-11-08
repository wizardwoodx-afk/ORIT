/**
 * SelfImpulse — brain.
 *
 * The loop, the tool host, and the prompt. Nothing here executes an effect: the loop proposes, the
 * gateway decides, a human signs, and the kernel replays. Read `loop.ts` first.
 */
export * from './gateway-tools.ts';
export * from './loop.ts';
export * from './prompt.ts';
export * from './tools.ts';
