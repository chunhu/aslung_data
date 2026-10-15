// devices.location can retain the last historical lab; it is not a current deployment.
export function isCurrentDeployment(location, now = Date.now()) {
  return Boolean(location.active) && !location.end_time && Date.parse(location.start_time) <= Number(now);
}

export function currentDeploymentMap(locations, now = Date.now()) {
  const current = new Map();
  for (const location of locations) {
    if (!isCurrentDeployment(location, now)) continue;
    const previous = current.get(location.aslung_id);
    if (!previous || Date.parse(location.start_time) > Date.parse(previous.start_time)
      || (Date.parse(location.start_time) === Date.parse(previous.start_time) && Number(location.id) > Number(previous.id))) {
      current.set(location.aslung_id, location);
    }
  }
  return current;
}
