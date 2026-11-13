function sanitizeLogMessage(message) {
  if (typeof message !== 'string') return message;
  return message
    .replace(/(password["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(UserPassword["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(LOCAL_DB_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(REMOTE_DB_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(DB_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, '$1***')
    .replace(/(JWT_SECRET["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***');
}

const test1 = 'User password: "Secret1234!" failed';
const test2 = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.XYZ';
const test3 = 'Connecting with LOCAL_DB_PASSWORD=Unipro@2026 to DB';
console.log(sanitizeLogMessage(test1));
console.log(sanitizeLogMessage(test2));
console.log(sanitizeLogMessage(test3));

