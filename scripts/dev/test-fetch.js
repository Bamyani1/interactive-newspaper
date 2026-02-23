fetch("http://localhost:3000/api/editions/1980-04-17/images/0006_Page%206_img1.jpg", { method: 'HEAD' })
  .then(r => console.log(r.status, r.statusText))
  .catch(e => console.error(e));
