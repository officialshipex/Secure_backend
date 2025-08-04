const express = require('express');


const  {saveSmartShip}= require('../AllCouriers/SmartShip/Authorize/smartShip.controller');
const { orderRegistrationOneStep } = require('../AllCouriers/SmartShip/Couriers/couriers.controller');

const router = express.Router();




router.post("/authorize",saveSmartShip);
router.post("/createShipment",orderRegistrationOneStep);


module.exports = router;