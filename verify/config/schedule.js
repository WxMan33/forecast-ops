/* Capture schedule. Targets are in each location's civil time zone. GitHub schedules run in UTC,
   can start late and can be skipped, so the collector is triggered a little BEFORE each target in
   both EST and EDT, waits until the target, and is re-triggered later as a backup. Every capture
   records its target and its actual start; nothing late is presented as on time. */
module.exports = {
  slots: [
    { id: "midday", local: "12:00" },
    { id: "evening", local: "23:30" },
  ],
  waitBeforeTargetMaxMin: 25, // a run that starts early sleeps until the target (at most this long)
  onTimeMaxMin: 15, // started within 15 min after the target: on_time
  lateMaxMin: 180, // 15-180 min: late (kept, labelled, excluded from matched on-time comparisons)
  // later than this: the slot is recorded as missed; a capture then is labelled "off_schedule"
};
