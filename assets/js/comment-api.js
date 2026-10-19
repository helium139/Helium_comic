// Reuse the existing Functions/App Check initialization without changing view accounting.
import { viewCallable } from './view-callables.js';
export const listComments = viewCallable('listComments');
export const createComment = viewCallable('createComment');
export const editComment = viewCallable('editComment');
export const deleteComment = viewCallable('deleteComment');
export const moderateComment = viewCallable('moderateComment');
