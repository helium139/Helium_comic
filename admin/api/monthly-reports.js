import { viewCallable } from '../../assets/js/view-callables.js';
export const getMonthlyViewDashboard = viewCallable('getMonthlyViewDashboard');
export const getMonthlyViewReports = viewCallable('getMonthlyViewReports');
// Report history initializes existing client App Check before this action is enabled.
export const retryMonthlyViewReport = viewCallable('retryMonthlyViewReport', {timeout: 540000});

export const generateMonthlyViewReport = viewCallable('generateMonthlyViewReport', {timeout: 540000});
