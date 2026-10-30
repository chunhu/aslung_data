export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { initAlertCron } = await import("./lib/alerts");
    initAlertCron();
    const { initCalibrationCron } = await import("./lib/calibration-cron");
    initCalibrationCron();
    const { initPersonalCron } = await import('./lib/personal-cron');
    initPersonalCron();
  }
}
