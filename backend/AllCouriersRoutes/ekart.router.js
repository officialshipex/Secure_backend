const express = require('express');


const  {saveEkart}= require('../AllCouriers/Ekart/Authorize/Ekart.controller');
// const { orderRegistrationOneStep } = require('../AllCouriers/SmartShip/Couriers/couriers.controller');

const router = express.Router();




router.post("/authorize",saveEkart);
// router.post("/createShipment",orderRegistrationOneStep);


module.exports = router;