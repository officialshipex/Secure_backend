const Order = require("../../models/newOrder.model");
const Joi = require("joi");

const externalOrderSchema = Joi.object({
  orderId: Joi.number().required(),
  pickupAddress: Joi.object({
    contactName: Joi.string().required(),
    email: Joi.string().email().optional(),
    phoneNumber: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .message("Phone number must be exactly 10 digits")
      .required(),
    address: Joi.string().required(),
    pinCode: Joi.string()
      .pattern(/^[0-9]{6}$/)
      .message("Pin code must be exactly 6 digits")
      .required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
  }).required(),

  receiverAddress: Joi.object({
    contactName: Joi.string().required(),
    email: Joi.string().email().optional(),
    phoneNumber: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .message("Phone number must be exactly 10 digits")
      .required(),
    address: Joi.string().required(),
    pinCode: Joi.string()
      .pattern(/^[0-9]{6}$/)
      .message("Pin code must be exactly 6 digits")
      .required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
  }).required(),

  productDetails: Joi.array()
    .items(
      Joi.object({
        id: Joi.number().required(),
        quantity: Joi.number().required(),
        name: Joi.string().required(),
        sku: Joi.string().optional(),
        unitPrice: Joi.string().required(),
      })
    )
    .min(1)
    .required(),

  packageDetails: Joi.object({
    deadWeight: Joi.number().required(),
    applicableWeight: Joi.number().required(),
    volumetricWeight: Joi.object({
      length: Joi.number().required(),
      width: Joi.number().required(),
      height: Joi.number().required(),
      calculatedWeight: Joi.number().optional(),
    }).required(),
  }).required(),

  paymentDetails: Joi.object({
    method: Joi.string().valid("COD", "Prepaid").required(),
    amount: Joi.number().when("method", {
      is: "Prepaid",
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  }).required(),

  channelId: Joi.number().optional(),
  commodityId: Joi.number().optional(),
});

const orderCreationController = async (req, res) => {
  try {
    // Validate input
    const { error, value } = externalOrderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const {
      orderId,
      pickupAddress,
      receiverAddress,
      productDetails,
      packageDetails,
      paymentDetails,
      channelId,
      commodityId,
    } = value;

    // Generate unique 6-digit order ID
    // let orderId;
    // let isUnique = false;
    // while (!isUnique) {
    //   orderId = Math.floor(100000 + Math.random() * 900000);
    //   const exists = await Order.findOne({ orderId });
    //   if (!exists) isUnique = true;
    // }

    const userId = req.user?._id || "external";
    const compositeOrderId = `${userId}-${orderId}`;
    // ✅ Check if this orderId already exists for this user
    const existingOrder = await Order.findOne({ compositeOrderId });
    if (existingOrder) {
      return res.status(409).json({
        success: false,
        message: `Duplicate orderId: ${orderId} already exists for this user.`,
      });
    }
    // Create and save shipment
    const shipment = new Order({
      userId,
      orderId,
      pickupAddress,
      receiverAddress,
      productDetails,
      packageDetails,
      paymentDetails,
      compositeOrderId,
      status: "new",
      channel: "api",
      channelId,
      commodityId,
      tracking: [
        {
          status: "Created",
          StatusDateTime: new Date(),
          Instructions: "Order created",
        },
      ],
    });
    console.log("shipment", shipment);
    await shipment.save();

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: {
        orderId: shipment.orderId,
        compositeOrderId: shipment.compositeOrderId,
        tracking: shipment.tracking,
        status: shipment.status,
      },
    });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = orderCreationController;
