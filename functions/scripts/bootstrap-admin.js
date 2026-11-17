// Legacy direct writers bypassed the access synchronization barrier.
// Do not use to provision production. See docs/current-staff-access.md.
console.error(
    "Direct claims/profile writer retired; see current-access setup runbook",
);
process.exitCode = 1;
