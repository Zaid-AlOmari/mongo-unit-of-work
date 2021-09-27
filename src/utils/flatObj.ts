
export function flatObj(obj: any) {
  const _set = {};
  const _flatObj = (obj: any, current: any) => {
    for (const [key, val] of Object.entries(obj)) {
      const newKey = (current ? current + '.' + key : key);
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        _flatObj(val, newKey);
      } else {
        _set[newKey] = val;
      }
    }
  };
  _flatObj(obj, undefined);
  return _set;
}