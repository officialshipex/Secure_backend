
const express = require("express");
const router = express.Router();

const shiprocketAuthorize = require("../AllCouriers/ShipRocket/Authorize/shiprocket.controller");

const { getAllActiveCourierServices, addService } = require("../AllCouriers/ShipRocket/Couriers/couriers.controller");

const {
    createCustomOrder,

    updateOrder,
    cancelOrder,

    listCouriers,
    checkServiceability,
    requestShipmentPickup,

    createReturnOrder,

    generateManifest,

    generateLabel,
    generateInvoice,
    getAllNDRShipments,

    getTrackingByAWB,

    getTrackingByOrderID,

} = require('../AllCouriers/ShipRocket/MainServices/mainServices.controller');

router.get('/saveNew', shiprocketAuthorize.saveShipRocket);
router.get('/isEnabeled', shiprocketAuthorize.isEnabeled);
router.get('/disable',shiprocketAuthorize.disable);
router.get('/enable',shiprocketAuthorize.enable);
router.post('/getToken', shiprocketAuthorize.getToken);

router.get("/getAllActiveCourierServices", getAllActiveCourierServices);

router.post("/addService", addService);

router.post('/createShipment', createCustomOrder);

router.put('/update-order/:order_id', updateOrder);
router.delete('/cancel-order/:order_id', cancelOrder);

// List of Couriers
router.get('/couriers', listCouriers);

// Check Courier Serviceability
// router.get('/courier-serviceability', checkServiceability);

// Request for Shipment Pickup
router.post('/request-pickup', requestShipmentPickup);

// Create a Return Order
router.post('/return-order', createReturnOrder);

// Generate Manifest
router.post('/manifest/generate', generateManifest);

// Generate Label
router.post('/label/generate', generateLabel);

// Generate Invoice
router.post('/invoice/generate', generateInvoice);

// Get All NDR Shipments
router.get('/ndr/all', getAllNDRShipments);

// Get Tracking through AWB
// router.get('/track/awb/:awb_code', getTrackingByAWB);

// Get Tracking Data through Order ID
router.get('/track/order/:order_id', getTrackingByOrderID);


// export default router;
module.exports = router
