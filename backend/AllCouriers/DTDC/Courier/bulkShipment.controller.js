const express = require("express");
const axios = require("axios");
const User = require("../../../models/User.model");
require("dotenv").config();
const Order = require("../../../models/newOrder.model");
const Wallet = require("../../../models/wallet");
const { getDTDCAuthToken } = require("../Authorize/saveCourierContoller");
const { getZone } = require("../../../Rate/zoneManagementController");
const commodityOptions = require("../../../config/commodityOptions");

// const router = express.Router();

// DTDC API Configuration from environment variables
const DTDC_API_URL = process.env.DTDC_API_URL;
const API_KEY = process.env.DTDC_API_KEY;
const X_ACCESS_TOKEN = process.env.DTDC_X_ACCESS_TOKEN;

// Create a new shipment
const createOrderDTDC = async (
  serviceDetails,
  orderId,
  wh,
  walletId,
  charges
) => {
  try {
    console.log("API Key:", API_KEY);
    console.log("Access Token:", X_ACCESS_TOKEN);

    // Fetch order, user, and wallet details
    const currentOrder = await Order.findById(orderId);
    if (!currentOrder) {
      return { success: false, message: "Order not found" };
    }

    const zone = await getZone(
      currentOrder.pickupAddress.pinCode,
      currentOrder.receiverAddress.pinCode
      // res
    );
    if (!zone) {
      return ({success:false, message: "Pincode not serviceable" });
    }

    const currentWallet = await Wallet.findById(walletId);
    if (!currentWallet) {
      return { success: false, message: "Wallet not found" };
    }
    const walletHoldAmount = currentWallet?.holdAmount || 0;
    const effectiveBalance = currentWallet.balance - walletHoldAmount;
    if (effectiveBalance < charges) {
      return { success: false, message: "Insufficient wallet balance" };
    }

    const productNames = currentOrder.productDetails
      .map((product) => product.name)
      .join(", "); // Convert array to a comma-separated string

    const lowerCaseProductNames = productNames.toLowerCase();
    let commodityId = "Others";
    for (const option of commodityOptions) {
      if (lowerCaseProductNames.includes(option.name.toLowerCase())) {
        commodityId = option.id;
        break;
      }
    }
    // Construct shipment payload
    const codCollectionMode =
      currentOrder.paymentDetails.method === "COD" ? "cash" : null;
    const codAmount =
      currentOrder.paymentDetails.method === "COD"
        ? currentOrder.paymentDetails.amount
        : 0;

    const shipmentData = {
      consignments: [
        {
          customer_code: "GL9711",
          service_type_id: serviceDetails.courier,
          load_type: "NON-DOCUMENT",
          description: productNames,
          dimension_unit: "cm",
          length: currentOrder.packageDetails.volumetricWeight.length,
          width: currentOrder.packageDetails.volumetricWeight.width,
          height: currentOrder.packageDetails.volumetricWeight.height,
          weight_unit: "kg",
          weight: currentOrder.packageDetails.applicableWeight,
          declared_value: currentOrder.paymentDetails.amount,
          num_pieces: currentOrder.productDetails.length,

          origin_details: {
            name: currentOrder.pickupAddress.contactName,
            phone: currentOrder.pickupAddress.phoneNumber,
            address_line_1: currentOrder.pickupAddress.address,
            pincode: currentOrder.pickupAddress.pinCode,
            city: currentOrder.pickupAddress.city,
            state: currentOrder.pickupAddress.state,
          },

          destination_details: {
            name: currentOrder.receiverAddress.contactName,
            phone: currentOrder.receiverAddress.phoneNumber,
            address_line_1: currentOrder.receiverAddress.address,
            pincode: currentOrder.receiverAddress.pinCode,
            city: currentOrder.receiverAddress.city,
            state: currentOrder.receiverAddress.state,
          },

          customer_reference_number: currentOrder.orderId,

          // Ensure COD mode is correctly set
          cod_collection_mode: codCollectionMode,
          cod_amount: codAmount,

          ...(serviceDetails.name === "Dtdc Air" && {
            commodity_id: commodityId,
          }),
          reference_number: "",
        },
      ],
    };

    // API call to DTDC
    let response;
    // if (currentWallet.balance >= finalCharges) {
    response = await axios.post(
      `${DTDC_API_URL}/customer/integration/consignment/softdata`,
      shipmentData,
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": API_KEY,
          Authorization: `Bearer ${X_ACCESS_TOKEN}`,
        },
      }
    );
    // } else {
    // return res.status(400).json({ success: false, message: "Low Balance" });
    // }
    if (response?.data?.data[0]?.success) {
      const result = response.data.data[0];
      currentOrder.status = "Ready To Ship";
      currentOrder.cancelledAtStage = null;
      currentOrder.awb_number = result.reference_number;
      currentOrder.shipment_id = `${result.customer_reference_number}`;
      currentOrder.provider = serviceDetails.provider;
      currentOrder.totalFreightCharges = charges;
      currentOrder.courierServiceName = serviceDetails.name;
      currentOrder.shipmentCreatedAt = new Date();
      currentOrder.zone = zone.zone;
      let savedOrder = await currentOrder.save();

      // console.log("sjakjska",balanceToBeDeducted)
      // Deduct wallet balance using atomic operation and update transaction
      const updatedWallet = await Wallet.findOneAndUpdate(
        { _id: walletId, balance: { $gte: charges } }, // Ensure sufficient balance
        [
          {
            $set: {
              balance: { $subtract: ["$balance", charges] }, // Deduct balance correctly
              transactions: {
                $concatArrays: [
                  "$transactions",
                  [
                    {
                      channelOrderId: currentOrder.orderId,
                      category: "debit",
                      amount: charges,
                      balanceAfterTransaction: {
                        $subtract: ["$balance", charges],
                      }, // Updated correctly
                      date: new Date()
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " "),
                      awb_number: result.reference_number,
                      description: `Freight Charges Applied`,
                    },
                  ],
                ],
              },
            },
          },
        ],
        { new: true } // Return updated wallet
      );

      
    } else {
      console.log("ererer", response.data);
      return { message: "Error creating shipment" };
    }

    console.log(response.data.data);

    return {
      message: "Shipment Created Successfully",
      success: true,
      orderId: currentOrder.orderId,
      waybill: response.data.data[0].reference_number,
    };
  } catch (error) {
    console.error(
      "Error creating shipment:",
      error.response?.data || error.message
    );
    return {
      success: false,
      message: "Failed to create shipment",
      error: error.response?.data || error.message,
    };
  }
};

module.exports = { createOrderDTDC };
