'use strict';

const fs = require('fs');

(async () => {
  const data = {hoge : [ "huga", "piyo"]};
  await fs.promises.writeFile('student-2.json', JSON.stringify(data));
})();

