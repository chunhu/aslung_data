// The old rule ends exactly where the new one starts; storage uses [start,end).
// Inclusive presentation subtracts one millisecond, without introducing a gap.
export function implicitCalibrationEnd(nextStart){
  return new Date(nextStart).toISOString();
}
export function inclusiveCalibrationEnd(end){
  return end?new Date(Date.parse(end)-1).toISOString():null;
}
