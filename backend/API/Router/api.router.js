const express=require("express");
const router=express.Router();

const { isAuthorized } = require("../../middleware/auth.middleware");
const orderCreationController = require("../Controller/orderCreation.controller");
const generateToken = require("../Controller/tokenGeneration.controller");

// Route to create a new order
router.post("/external/createOrder", isAuthorized, orderCreationController);
router.post("/external/generateToken", generateToken);

module.exports = router;