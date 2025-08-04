const axios = require("axios");
require("dotenv").config();
const { getAccessToken } = require("../Authorize/smartShip.controller");
const Order = require("../../../models/newOrder.model");
const { getZone } = require("../../../Rate/zoneManagementController");
const Wallet = require("../../../models/wallet");
const User = require("../../../models/User.model");
const {registerSmartshipHub}=require("./couriers.controller")
const orderRegistrationOneStep = async (serviceDetails,orderId,wh,walletId,charges) => {
  try {
    console.log("req.body",serviceDetails,orderId,walletId,charges);
    const accessToken = await getAccessToken();
    const currentOrder = await Order.findById(orderId);
    if (!currentOrder) {
      return { success: false, message: "Order not found" };
    }
    const zone = await getZone(
      currentOrder.pickupAddress.pinCode,
      currentOrder.receiverAddress.pinCode
      // res
    );
    // console.log("zone", zone);
    if (!zone) {
      return ({success:false, message: "Pincode not serviceable" });
    }
    const user = await User.findById(currentOrder.userId);
    if (!user) {
      return ({ success: false, message: "User not found" });
    }


    const smartshipHub = await registerSmartshipHub(
      user._id,
      currentOrder.pickupAddress.pinCode
    );
    console.log("Smartship Hub:", smartshipHub);

    const currentWallet = await Wallet.findById(user.Wallet);
    if (!currentWallet) {
      return { success: false, message: "Wallet not found" };
    }

    const effectiveBalance =
      currentWallet.balance - (currentWallet.holdAmount || 0);
    if (effectiveBalance < charges) {
      return ({ success: false, message: "Insufficient wallet balance" });
    }

    const productNames = currentOrder.productDetails
      .map((p) => p.name)
      .join(", ");

    const payload = {
      request_info: {
        client_id: "", // Optional
        run_type: "create",
      },
      orders: [
        {
          client_order_reference_id: currentOrder.orderId,
          shipment_type: 1,
          order_collectable_amount:
            currentOrder.paymentDetails.method === "COD"
              ? currentOrder.paymentDetails.amount
              : 0,
          total_order_value: currentOrder.paymentDetails.amount.toString(),
          payment_type: currentOrder.paymentDetails.method.toLowerCase(), // cod or prepaid
          package_order_weight: (
            currentOrder.packageDetails.applicableWeight * 1000
          ).toString(), // in grams
          package_order_length:
            currentOrder.packageDetails.volumetricWeight.length.toString(),
          package_order_height:
            currentOrder.packageDetails.volumetricWeight.height.toString(),
          package_order_width:
            currentOrder.packageDetails.volumetricWeight.width.toString(),
          shipper_hub_id: smartshipHub.hubId || "",
          shipper_gst_no: "",
          order_invoice_date: new Date().toISOString().slice(0, 10), // today's date (or you can pull from order)
          order_invoice_number: `INV-${currentOrder.orderId}-${Date.now()}`, // optional
          is_return_qc: "0",
          return_reason_id: "0",
          order_meta: {
            preferred_carriers: [279], // use given courier
          },
          product_details: currentOrder.productDetails.map((product) => ({
            client_product_reference_id: product._id.toString(),
            product_name: product.name,
            product_category: product.category || "General",
            product_hsn_code: product.hsn || "0000",
            product_quantity: product.quantity || 1,
            product_gst_tax_rate: product.gst || "0",
            product_invoice_value: product.unitPrice.toString(),
          })),
          consignee_details: {
            consignee_name: currentOrder.receiverAddress.contactName,
            consignee_phone: currentOrder.receiverAddress.phoneNumber,
            consignee_email:
              currentOrder.receiverAddress.email || "noemail@example.com",
            consignee_complete_address: currentOrder.receiverAddress.address,
            consignee_pincode: currentOrder.receiverAddress.pinCode,
          },
        },
      ],
    };

    const response = await axios.post(
      "https://api.smartship.in/v2/app/Fulfillmentservice/orderRegistrationOneStep",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    console.log("Smartship Order Response:", response.data);
    // console.log(
    //   "Smartship Order Response:",
    //   response.data.data.errors.account_validation
    // );

    // Duplicate order check
    const respData = response.data?.data;
    if (
      (!respData?.success_order_details ||
        !respData.success_order_details.orders ||
        respData.success_order_details.orders.length === 0) &&
      respData?.duplicate_orders
    ) {
      return ({
        success: false,
        message:
          "Duplicate orderId is not allowed in courier Bluedart, ship with another courier",
        errors: respData.errors,
        duplicate_orders: respData.duplicate_orders,
      });
    }
    // Save AWB and update order status
    const result = response.data?.data?.success_order_details?.orders?.[0];

    if (result?.awb_number) {
      currentOrder.status = "Ready To Ship";
      currentOrder.awb_number = result.awb_number;
      currentOrder.shipment_id = result.request_order_id || "";
      currentOrder.provider = serviceDetails.provider;
      currentOrder.totalFreightCharges = charges;
      currentOrder.courierServiceName = serviceDetails.name;
      currentOrder.shipmentCreatedAt = new Date();
      currentOrder.zone = zone.zone;
      await currentOrder.save();

      const updatedWallet=await Wallet.findOneAndUpdate(
        {_id:walletId,balance:{$gte:charges}},
        [
          {
            $set:{
              balance:{$subtract:["$balance",charges]},
              transactions:{
                $concatArrays:[
                  "$transactions",
                  [
                    {
                      channelOrderId:currentOrder.orderId,
                      category:"debit",
                      amount:charges,
                      balanceAfterTransaction:{
                        $subtract:["$balance",charges],
                      },
                      date:new Date().toISOString().slice(0,16).replace("T"," "),
                      awb_number:result.awb_number,
                      description:"Freight Charges Applied",
                    },
                  ],
                ],
              },
            },
          },
        ],
        {new:true}
      )
    }
    else{
      return {message:"Error creating shipment"};
    }

    return {
      message: "Shipment Created Successfully",
      success: true,
      orderId:currentOrder.orderId,
      waybill:response.data?.data?.success_order_details?.orders?.[0].awb_number
    };
  } catch (error) {
    console.error(
      "Smartship Order Registration Error:",
      error?.response?.data || error.message
    );
    return {
      success: false,
      message: "Failed to create shipment",
      error: error?.response?.data || error.message,
    };
  }
};

module.exports={orderRegistrationOneStep}
