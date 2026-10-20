import { viewCallable } from '../../assets/js/view-callables.js';
import { app } from '../../assets/js/firebase.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js';
export const getMonthlyViewDashboard = viewCallable('getMonthlyViewDashboard');
export const getMonthlyViewReports = viewCallable('getMonthlyViewReports');
// Report history initializes existing client App Check before this action is enabled.
const retry = httpsCallable(getFunctions(app, 'us-central1'), 'retryMonthlyViewReport', {timeout: 540000});
export const retryMonthlyViewReport = async data => (await retry(data)).data;

const generate = httpsCallable(getFunctions(app, 'us-central1'), 'generateMonthlyViewReport', {timeout: 540000});
export const generateMonthlyViewReport = async data => (await generate(data)).data;
