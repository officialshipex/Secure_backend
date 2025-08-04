const express = require("express");
const router = express.Router();
const authorizeController = require("../AllCouriers/ShreeMaruti/Authorize/shreeMaruti.controller");

const shreeMarutiController = require("../AllCouriers/ShreeMaruti/Couriers/couriers.controller");

router.post("/getAuthToken",authorizeController.getAuthToken);

router.get("/getCourierList", shreeMarutiController.getCourierList);
router.post("/addService", shreeMarutiController.addService);
router.post("/createShipment", shreeMarutiController.createOrder);
router.post("/generatePickup",shreeMarutiController.createManifest);

module.exports = router;
