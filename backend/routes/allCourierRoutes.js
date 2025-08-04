const express = require('express');
const router = express.Router();

// Correctly import both functions from the same module
const { getAllCouriers, deleteCourier,updateStatusController } = require('../AllCouriers/getActiveCourier');

router.get('/couriers', getAllCouriers);
router.post('/updateStatus',updateStatusController)
router.delete('/deleteCourier/:id', deleteCourier);

module.exports = router;
