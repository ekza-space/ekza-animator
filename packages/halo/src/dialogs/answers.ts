// The kernel's answers to the Bind Skin questions (STUDIO-TOUCH-SPEC §6.7): a lazy chunk the inline confirm card loads
// when it is answered, so `/app`'s first load never carries the rig workspace's bind module.
export { answerRebind, answerUnbind } from '@ekza-studio/editor-core';
