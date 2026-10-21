// Accept finite decimal readings without coercing blanks, booleans or hex input.
export function measurementNumber(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value!=='string'||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))return null;
  const number=Number(value.trim());return Number.isFinite(number)?number:null;
}
