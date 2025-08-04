const Order = require("../models/newOrder.model");
const Wallet = require("../models/wallet");
const User = require("../models/User.model");
const DTDCStatusMapping = require("./DTDCStatusMapping");
const SmartShipStatusMaping = require("./SmartShipStatusMapping");
const cron = require("node-cron");
const {
  shipmentTrackingforward,
} = require("../AllCouriers/EcomExpress/Couriers/couriers.controllers");
const {
  trackShipment,
} = require("../AllCouriers/Xpressbees/MainServices/mainServices.controller");
const {
  trackShipmentDelhivery,
} = require("../AllCouriers/Delhivery/Courier/couriers.controller");
const {
  getShipmentTracking,
} = require("../AllCouriers/Amazon/Courier/couriers.controller");
const {
  trackOrderShreeMaruti,
} = require("../AllCouriers/ShreeMaruti/Couriers/couriers.controller");
const {
  trackOrderDTDC,
} = require("../AllCouriers/DTDC/Courier/couriers.controller");
const {
  trackOrderSmartShip,
} = require("../AllCouriers/SmartShip/Couriers/couriers.controller");
const Bottleneck = require("bottleneck");
const orderSchemaModel = require("../models/orderSchema.model");

const limiter = new Bottleneck({
  minTime: 1000, // 10 requests per second (1000ms delay between each)
  maxConcurrent: 10, // Maximum 10 at the same time
  reservoir: 750, // Max 750 calls per minute
  reservoirRefreshAmount: 750,
  reservoirRefreshInterval: 60 * 1000, // Refresh every 1 minute
});

const trackSingleOrder = async (order) => {
  try {
    // console.log("Tracking order:", order.orderId);
    const { provider, awb_number, shipment_id } = order;
    if (!provider || !awb_number) return;

    const currentWallet = await Wallet.findById(
      (
        await User.findById((await Order.findOne({ awb_number })).userId)
      ).Wallet
    );

    const trackingFunctions = {
      Xpressbees: trackShipment,
      Delhivery: trackShipmentDelhivery,
      ShreeMaruti: trackOrderShreeMaruti,
      DTDC: trackOrderDTDC,
      EcomExpress: shipmentTrackingforward,
      Amazon: getShipmentTracking,
      Smartship: trackOrderSmartShip,
    };

    if (!trackingFunctions[provider]) {
      console.warn(`Unknown provider: ${provider} for Order ID: ${order._id}`);
      return;
    }

    const result = await trackingFunctions[provider](awb_number, shipment_id);
    if (!result || !result.success || !result.data) return;

    const normalizedData = mapTrackingResponse(result.data, provider);
    if (!normalizedData) {
      console.warn(`Failed to map tracking data for AWB: ${awb_number}`);
      return;
    }
    let shouldUpdateWallet = false;
    let balanceTobeAdded = 0;

    if (provider === "EcomExpress") {
      const ecomExpressStatusMapping = {
        "soft data uploaded": "Ready To Ship",
        "pickup assigned": "In-transit",
        "out for pickup": "In-transit",
        "pickup failed": "Ready To Ship",
        "pickup scheduled": "Ready To Ship",
        "field pickup done": "In-transit",
        bagged: "In-transit",
        "bag added to connection": "In-transit",
        "departed from location": "In-transit",
        "redirected to another": "In-transit",
        "bag inscan at location": "In-transit",
        "origin facility inscan": "In-transit",
        "shipment inscan at location": "In-transit",
        "shipment debagged at location": "In-transit",
        "redirected to another delivery center (dc update) ": "In-transit",
        "out for delivery": "Out for Delivery",
        undelivered: "Undelivered",
        "mass update": "Undelivered",
        delivered: "Delivered",
        "arrived at destination": "In-transit",
        "ofd lock": "RTO",
        "rto lock": "RTO",
        returned: "RTO In-transit",
        cancelled: "Cancelled",
        lost: "Cancelled",
        // undelivered: "In-transit",
        "not picked": "Ready To Ship",
      };

      const instruction = normalizedData.Instructions?.toLowerCase();
      order.status = ecomExpressStatusMapping[instruction];

      if (ecomExpressStatusMapping[instruction] === "Out for Delivery") {
        order.ndrStatus = "Out for Delivery";
      }
      console.log("status", normalizedData.Status, normalizedData.Instructions);

      if (order.status === "RTO In-transit" && result.rto_awb) {
        order.awb_number = result.rto_awb;
      } else {
        order.awb_number = result.data.awb_number;
      }
      if (
        normalizedData.Status === "Returned" &&
        normalizedData.Instructions === "Undelivered"
      ) {
        console.log("rto", order.awb_number);
        order.status = "RTO In-transit";
        order.ndrStatus = "RTO In-transit";
      }
      if (
        (order.status === "RTO" || order.status === "RTO In-transit") &&
        (instruction === "bagged" ||
          instruction === "bag added to connection" ||
          instruction === "departed from location" ||
          instruction === "bag inscan at location" ||
          instruction === "shipment debagged at location")
      ) {
        order.status = "RTO In-transit";
        order.ndrStatus = "RTO In-transit";
      }
      if (
        (order.ndrStatus === "Undelivered" ||
          order.ndrStatus === "Out for Delivery") &&
        normalizedData.Instructions === "Delivered"
      ) {
        order.ndrStatus = "Delivered";
      }

      if (
        normalizedData.Instructions === "Undelivered" &&
        order.ndrStatus !== "Action_Requested" &&
        normalizedData.Instructions !== "Out for delivery"
      ) {
        order.status = "Undelivered";
        order.ndrStatus = "Undelivered";
        order.ndrReason = {
          date: normalizedData.StatusDateTime,
          reason: normalizedData.ReasonCode,
        };
        // if (!Array.isArray(order.ndrHistory)) {
        //   order.ndrHistory = [];
        // }
        const lastEntryDate = new Date(
          order.ndrHistory[order.ndrHistory.length - 1]?.date
        ).toDateString();
        const currentStatusDate = new Date(
          normalizedData.StatusDateTime
        ).toDateString();

        if (
          order.ndrHistory.length === 0 ||
          lastEntryDate !== currentStatusDate
        ) {
          const attemptCount = order.ndrHistory?.length || 0;
          if (normalizedData.Instructions === "Undelivered") {
            // console.log("ecom", normalizedData.ReasonCode);

            order.ndrHistory.push({
              date: normalizedData.StatusDateTime,
              action: "Auto Reattempt",
              remark: normalizedData.ReasonCode,
              attempt: attemptCount + 1,
            });
          }
        }
      }

      if (
        (order.status === "RTO" || order.status === "RTO In-transit") &&
        instruction === "delivered"
      ) {
        order.status = "RTO Delivered";
        order.ndrStatus = "RTO Delivered";
      }
    }
    if (provider === "DTDC") {
      const instruction = normalizedData.Instructions?.toLowerCase();
      order.status = DTDCStatusMapping[instruction];

      if (order.status === "RTO") {
        order.ndrStatus = "RTO";
      }
      if (order.status === "RTO In-transit") {
        order.ndrStatus = "RTO In-transit";
      }

      if (DTDCStatusMapping[instruction] === "Out for Delivery") {
        order.ndrStatus = "Out for Delivery";
      }
      if (
        (order.ndrStatus === "Undelivered" ||
          order.ndrStatus === "Out for Delivery") &&
        normalizedData.Instructions === "Delivered"
      ) {
        order.ndrStatus = "Delivered";
      }
      const trackingLength = order.tracking?.length || 0;
      const previousStatus =
        trackingLength >= 2 ? order.tracking[trackingLength - 2]?.status : null;
      if (
        normalizedData.Instructions === "Return as per client instruction." &&
        (trackingLength === 0 ||
          (previousStatus !== "NONDLV" &&
            previousStatus !== "Not Delivered" &&
            previousStatus !== "SETRTO"))
      ) {
        // console.log("awb with number", awb_number);
        order.status = "Cancelled";
        order.ndrStatus = "Cancelled";
        balanceTobeAdded =
          order.totalFreightCharges === "N/A"
            ? 0
            : parseInt(order.totalFreightCharges);
        shouldUpdateWallet = true;
      }

      if (normalizedData.Status === "SETRTO") {
        order.reattempt = true;
      } else {
        order.reattempt = false;
      }

      if (
        DTDCStatusMapping[instruction] === "Undelivered" ||
        normalizedData.Instructions === "RTO Not Delivered"
      ) {
        order.status = "Undelivered";
        order.ndrStatus = "Undelivered";
        order.ndrReason = {
          date: normalizedData.StatusDateTime,
          reason: normalizedData.StrRemarks,
        };
        // if (!Array.isArray(order.ndrHistory)) {
        //   order.ndrHistory = [];
        // }
        const lastEntryDate = new Date(
          order.ndrHistory[order.ndrHistory.length - 1]?.date
        ).toDateString();
        const currentStatusDate = new Date(
          normalizedData.StatusDateTime
        ).toDateString();

        if (
          lastEntryDate !== currentStatusDate ||
          order.ndrHistory.length === 0
        ) {
          const attemptCount = order.ndrHistory?.length || 0;
          if (DTDCStatusMapping[instruction] === "Undelivered") {
            // process.exit(1)
            order.ndrHistory.push({
              date: normalizedData.StatusDateTime,
              action: "Auto Reattempt",
              remark: normalizedData.StrRemarks,
              attempt: attemptCount + 1,
            });
            // normalizedData.StrRemarks="";
          }
        }
        updateNdrHistoryByAwb(order.awb_number);
      }

      if (
        (order.status === "RTO" || order.status === "RTO In-transit") &&
        instruction === "rto delivered"
      ) {
        order.status = "RTO Delivered";
        order.ndrStatus = "RTO Delivered";
      }
      if (
        instruction === "delivered" ||
        instruction === "otp based delivered"
      ) {
        order.status = "Delivered";
        // order.ndrStatus = "Delivered";
      }
    }
    if (provider === "Amazon") {
      // console.log("Amazon", normalizedData);
      if (normalizedData.ShipmentType === "FORWARD") {
        if (normalizedData.Instructions === "ReadyForReceive") {
          order.status = "Ready To Ship";
        }
        console.log("Instructions", normalizedData.Instructions);
        if (
          normalizedData.Instructions === "PickupDone" ||
          normalizedData.Instructions === "ArrivedAtCarrierFacility" ||
          normalizedData.Instructions === "Departed"
        ) {
          order.status = "In-transit";
        }
        if (normalizedData.Instructions === "OutForDelivery") {
          order.status = "Out for Delivery";
          order.ndrStatus = "Out for Delivery";
        }
        if (normalizedData.Instructions === "Delivered") {
          order.status = "Delivered";
        }
        if (
          (order.ndrStatus === "Undelivered" ||
            order.ndrStatus === "Out for Delivery") &&
          normalizedData.Instructions === "Delivered"
        ) {
          order.ndrStatus = "Delivered";
        }
        // console.log(
        //   "awb",
        //   order.awb_number,
        //   "time",
        //   normalizedData.StatusDateTime
        // );
        const secondLastTracking =
          Array.isArray(order.tracking) && order.tracking.length >= 2
            ? order.tracking[order.tracking.length - 2]
            : null;
        const wasPreviousDeliveryAttempted =
          secondLastTracking?.Instructions === "DeliveryAttempted";
        if (
          normalizedData.Instructions === "DeliveryAttempted" ||
          wasPreviousDeliveryAttempted
        ) {
          console.log("awb", order.awb_number);
          order.status = "Undelivered";
          order.ndrStatus = "Undelivered";
          order.ndrReason = {
            date: normalizedData.StatusDateTime,
            reason: normalizedData.StrRemarks,
          };
          // if (!Array.isArray(order.ndrHistory)) {
          //   order.ndrHistory = [];
          // }
          const lastEntryDate = new Date(
            order.ndrHistory[order.ndrHistory.length - 1]?.date
          ).toDateString();
          const currentStatusDate = new Date(
            normalizedData.StatusDateTime
          ).toDateString();

          if (
            order.ndrHistory.length === 0 ||
            lastEntryDate !== currentStatusDate
          ) {
            const attemptCount = order.ndrHistory?.length || 0;
            if (
              normalizedData.Instructions === "DeliveryAttempted" ||
              order.tracking[order.tracking.length - 2].Instructions ===
                "DeliveryAttempted"
            ) {
              order.ndrHistory.push({
                date: normalizedData.StatusDateTime,
                action: "Auto Reattempt",
                remark: normalizedData.StrRemarks,
                attempt: attemptCount + 1,
              });
            }
          }
          updateNdrHistoryByAwb(order.awb_number);
        }
      } else {
        if (
          normalizedData.Instructions === "ReturnInitiated" &&
          order.status === "Undelivered"
        ) {
          order.status = "RTO";
          order.ndrStatus = "RTO";
        }
        if (
          normalizedData.Instructions === "ArrivedAtCarrierFacility" ||
          normalizedData.Instructions === "Departed" ||
          normalizedData.Instructions ===
            "Package arrived at the carrier facility" ||
          normalizedData.Instructions ===
            "Package has left the carrier facility"
        ) {
          order.status = "RTO In-transit";
          order.ndrStatus = "RTO In-transit";
        }
        if (normalizedData.Instructions === "ReturnInitiated") {
          order.status = "RTO In-transit";
        }
        // if (normalizedData.Instructions === "OutForDelivery") {
        //   order.status = "RTO Out for Delivery";
        // }
        if (normalizedData.Instructions === "Delivered") {
          order.status = "RTO Delivered";
          order.ndrStatus = "RTO Delivered";
        }
      }
    }
    if (provider === "Smartship") {
      const instruction = normalizedData.Instructions?.toLowerCase();
      console.log("Smartship instruction", instruction);
      order.status = SmartShipStatusMaping[instruction];
      if (order.status === "RTO") {
        order.ndrStatus = "RTO";
      }
      console.log("Smartship instruction", instruction);
      if (order.status === "RTO In-transit") {
        order.ndrStatus = "RTO In-transit";
      }

      if (SmartShipStatusMaping[instruction] === "Out for Delivery") {
        order.ndrStatus = "Out for Delivery";
      }
      if (
        (order.ndrStatus === "Undelivered" ||
          order.ndrStatus === "Out for Delivery") &&
        (normalizedData.Instructions === "Delivered" ||
          normalizedData.Instructions === "Delivery Confirmed by Customer")
      ) {
        order.ndrStatus = "Delivered";
      }
      if (SmartShipStatusMaping[instruction] === "Undelivered") {
        order.status = "Undelivered";
        order.ndrStatus = "Undelivered";
        order.ndrReason = {
          date: normalizedData.StatusDateTime,
          reason: normalizedData.StrRemarks,
        };
        // if (!Array.isArray(order.ndrHistory)) {
        //   order.ndrHistory = [];
        // }
        const lastEntryDate = new Date(
          order.ndrHistory[order.ndrHistory.length - 1]?.date
        ).toDateString();
        const currentStatusDate = new Date(
          normalizedData.StatusDateTime
        ).toDateString();

        if (
          lastEntryDate !== currentStatusDate ||
          order.ndrHistory.length === 0
        ) {
          const attemptCount = order.ndrHistory?.length || 0;
          if (DTDCStatusMapping[instruction] === "Undelivered") {
            // process.exit(1)
            order.ndrHistory.push({
              date: normalizedData.StatusDateTime,
              action: "Auto Reattempt",
              remark: normalizedData.StrRemarks,
              attempt: attemptCount + 1,
            });
            // normalizedData.StrRemarks="";
          }
        }
        updateNdrHistoryByAwb(order.awb_number);
      }
      if (
        (order.status === "RTO" || order.status === "RTO In-transit") &&
        (instruction === "rto delivered to shipper" ||
          instruction === "rto delivered to fc")
      ) {
        order.status = "RTO Delivered";
        order.ndrStatus = "RTO Delivered";
      }
      if (
        instruction === "delivered" ||
        instruction === "delivery confirmed by customer"
      ) {
        order.status = "Delivered";
        // order.ndrStatus = "Delivered";
      }
    } else {
      const statusMap = {
        "UD:Manifested": { status: "Ready To Ship" },
        "UD:In Transit": { status: "In-transit" },
        "UD:Dispatched": {
          status: "Out for Delivery",
          ndrStatus: "Out for Delivery",
        },
        "RT:In Transit": {
          status: "RTO In-transit",

          ndrStatus: "RTO In-transit",
        },
        "DL:RTO": { status: "RTO Delivered", ndrStatus: "RTO Delivered" },
        "DL:Delivered": { status: "Delivered" },
      };

      const key = `${normalizedData.StatusType}:${normalizedData.Status}`;
      const mapped = statusMap[key];

      if (mapped) {
        order.status = mapped.status;
        if (mapped.ndrStatus) order.ndrStatus = mapped.ndrStatus;
      } else if (
        normalizedData.StatusType === "UD" &&
        normalizedData.Status === "Pending" &&
        normalizedData.StatusCode === "ST-108"
      ) {
        order.status = "RTO";
      }

      if (
        (order.ndrStatus === "Undelivered" ||
          order.ndrStatus === "Out for Delivery") &&
        normalizedData.Status === "Delivered"
      ) {
        order.ndrStatus = "Delivered";
      }

      const eligibleNSLCodes = [
        "EOD-74",
        "EOD-15",
        "EOD-104",
        "EOD-43",
        "EOD-86",
        "EOD-11",
        "EOD-69",
        "EOD-6",
      ];
      // if (!Array.isArray(order.ndrHistory)) {
      //   order.ndrHistory = [];
      // }
      const lastEntryDate = new Date(
        order.ndrHistory[order.ndrHistory.length - 1]?.date
      ).toDateString();
      const currentStatusDate = new Date(
        normalizedData.StatusDateTime
      ).toDateString();

      if (
        order.ndrHistory.length === 0 ||
        lastEntryDate !== currentStatusDate
      ) {
        if (
          normalizedData.StatusCode &&
          eligibleNSLCodes.includes(normalizedData.StatusCode)
        ) {
          order.ndrStatus = "Undelivered";
          order.status = "Undelivered";
          order.ndrReason = {
            date: normalizedData.StatusDateTime,
            reason: normalizedData.Instructions,
          };
        }
        const attemptCount = order.ndrHistory?.length || 0;
        order.ndrHistory.push({
          date: normalizedData.StatusDateTime,
          action: "Auto Reattempt",
          remark: normalizedData.Instructions,
          attempt: attemptCount + 1,
        });
        updateNdrHistoryByAwb(order.awb_number);
      }
    }

    const lastTrackingEntry = order.tracking[order.tracking.length - 1];

    const isSameCheckpoint =
      lastTrackingEntry &&
      lastTrackingEntry.StatusLocation === normalizedData.StatusLocation &&
      new Date(lastTrackingEntry.StatusDateTime).getTime() ===
        new Date(normalizedData.StatusDateTime).getTime();

    if (isSameCheckpoint) {
      // Just update the last entry if the checkpoint is the same
      lastTrackingEntry.status = normalizedData.Status;
      lastTrackingEntry.Instructions = normalizedData.Instructions;
      await order.save();
    } else if (
      !lastTrackingEntry ||
      lastTrackingEntry?.Instructions !== normalizedData.Instructions
    ) {
      // It's a new checkpoint, so push it
      order.tracking.push({
        status: normalizedData.Status,
        StatusLocation: normalizedData.StatusLocation,
        StatusDateTime: normalizedData.StatusDateTime,
        Instructions: normalizedData.Instructions,
      });
      await order.save();
      console.log("saved");
      if (shouldUpdateWallet && balanceTobeAdded > 0) {
        // Step 0: Check if same awb_number already exists twice
        const awbCount = await Wallet.aggregate([
          { $match: { _id: currentWallet._id } },
          { $unwind: "$transactions" },
          { $match: { "transactions.awb_number": order.awb_number || "" } },
          { $count: "count" },
        ]);

        const existingCount = awbCount[0]?.count || 0;

        if (existingCount >= 2) {
          console.log(
            `Skipping wallet update for AWB: ${order.awb_number}, already logged twice.`
          );
          return; // Exit if already present twice
        }

        // Step 1: Update balance
        await Wallet.updateOne(
          { _id: currentWallet._id },
          { $inc: { balance: balanceTobeAdded } }
        );

        // Step 2: Get updated wallet balance
        const updatedWallet = await Wallet.findById(currentWallet._id);

        // Step 3: Push the transaction with correct balance
        await Wallet.updateOne(
          { _id: currentWallet._id },
          {
            $push: {
              transactions: {
                channelOrderId: order.orderId || null,
                category: "credit",
                amount: balanceTobeAdded,
                balanceAfterTransaction: updatedWallet.balance,
                date: new Date().toISOString().slice(0, 16).replace("T", " "),
                awb_number: order.awb_number || "",
                description: "Freight Charges Received",
              },
            },
          }
        );

        console.log(
          "Wallet updated for AWB:",
          order.awb_number,
          "Amount:",
          balanceTobeAdded
        );
      }
    }
  } catch (error) {
    console.error(
      `Error tracking order ID: ${order._id}, AWB: ${order.awb_number} ${error}`
    );
  }
};

// Main controller
const trackOrders = async () => {
  try {
    const pLimit = await import("p-limit").then((mod) => mod.default);
    const limit = pLimit(10); // Max 10 concurrent executions

    const allOrders = await Order.find({
      status: { $nin: ["new", "Cancelled", "Delivered", "RTO Delivered"] },
    });

    console.log(`📦 Found ${allOrders.length} orders to track`);

    const limitedTrack = limiter.wrap(trackSingleOrder); // apply rate limiter

    const trackingPromises = allOrders.map(
      (order) => limit(() => limitedTrack(order)) // limit concurrency
    );

    await Promise.all(trackingPromises);

    console.log("✅ All tracking updates completed");
  } catch (error) {
    console.error("❌ Error in tracking orders:", error);
  }
};

const startTrackingLoop = async () => {
  try {
    console.log("🕒 Starting Order Tracking");
    await trackOrders();
    console.log("⏳ Waiting for 1 hours before next tracking cycle...");
    setTimeout(startTrackingLoop, 1 * 60 * 60 * 1000); // Wait 3 hours, then call again
  } catch (error) {
    console.error("❌ Error in tracking loop:", error);
    setTimeout(startTrackingLoop, 15 * 60 * 1000); // Retry after 5 minutes even on error
  }
};

// startTrackingLoop();

const mapTrackingResponse = (data, provider) => {
  if (provider === "Smartship") {
    // console.log("Smartship data", data);
    const scans = data?.scans;
    const orderId = Object.keys(scans || {})[0]; // only one AWB per call
    const scanArray = scans?.[orderId];
    const latestScan = scanArray?.[0];
    // console.log("latestScan", latestScan);
    return {
      Status: latestScan?.status_description || "N/A",
      StrRemarks: latestScan?.status_description || "N/A",
      StatusLocation: latestScan?.location || "Unknown",
      StatusDateTime: formatSmartShipDateTime(latestScan?.date_time) || null,
      Instructions: latestScan?.action || "N/A",
    };
  }
  const providerMappings = {
    EcomExpress: {
      Status: data.rts_system_delivery_status || "N/A",
      StatusLocation: data.current_location_name || "N/A",
      StatusDateTime: data.last_update_datetime || null,
      Instructions: data.tracking_status || null,
      ReasonCode: data.reason_code_description || null,
    },
    DTDC: {
      Status: data.trackDetails?.length
        ? data.trackDetails[data.trackDetails.length - 1].strCode
        : "N/A",
      StrRemarks: data.trackHeader?.strRemarks || "N/A",
      StatusLocation: data.trackDetails?.length
        ? data.trackDetails[data.trackDetails.length - 1].strOrigin
        : "N/A",
      StatusDateTime: data.trackDetails?.length
        ? formatDTDCDateTime(
            data.trackDetails[data.trackDetails.length - 1].strActionDate,
            data.trackDetails[data.trackDetails.length - 1].strActionTime
          )
        : null,
      Instructions: data.trackDetails?.length
        ? data.trackDetails[data.trackDetails.length - 1].strAction
        : "N/A",
    },

    Amazon: {
      Status: data.summary?.status || "N/A",
      StrRemarks:
        data.eventHistory?.length &&
        data.eventHistory[data.eventHistory.length - 1]?.shipmentType ===
          "FORWARD"
          ? data.summary?.trackingDetailCodes?.forward?.[0]
          : data.summary?.trackingDetailCodes?.reverse?.[1],
      StatusLocation: data.eventHistory?.length
        ? data.eventHistory[data.eventHistory.length - 1]?.location?.city
        : "N/A",
      StatusDateTime: data.eventHistory?.length
        ? formatAmazonDate(
            data.eventHistory[data.eventHistory.length - 1]?.eventTime
          )
        : "N/A",
      Instructions: data.eventHistory?.length
        ? data.eventHistory[data.eventHistory.length - 1]?.eventCode
        : "N/A",
      ShipmentType: data.eventHistory?.length
        ? data.eventHistory[data.eventHistory.length - 1]?.shipmentType
        : "N/A",
    },

    Shiprocket: {
      Status: data.current_status || null,
      StatusLocation: data.location || "Unknown",
      StatusDateTime: data.timestamp || null,
      Instructions: data.instructions || null,
    },
    NimbusPost: {
      Status: data.status || null,
      StatusCode: data.status_code || null,
      StatusLocation: data.city || "Unknown",
      StatusDateTime: data.updated_on || null,
      Instructions: data.remarks || null,
    },
    Delhivery: {
      Status: data.Status || "N/A",
      StatusType: data.StatusType || "N/A",
      StatusCode: data.StatusCode || null,
      StatusLocation: data.StatusLocation || "Unknown",
      StatusDateTime: data.StatusDateTime || null,
      Instructions: data.Instructions || null,
    },
    Xpressbees: {
      Status: data.tracking_status || null,
      StatusCode: data.status_code || null,
      StatusLocation: data.location || "Unknown",
      StatusDateTime: data.last_update || null,
      Instructions: data.remarks || null,
    },
    ShreeMaruti: {
      Status: data.status || null,
      StatusCode: data.status_code || null,
      StatusLocation: data.current_location || "Unknown",
      StatusDateTime: data.updated_at || null,
      Instructions: data.message || null,
    },
  };

  return providerMappings[provider] || null;
};

const formatDTDCDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr || dateStr.length !== 8 || timeStr.length !== 4) {
    return null; // Handle invalid inputs
  }

  try {
    // Extract date components
    const day = parseInt(dateStr.slice(0, 2));
    const month = parseInt(dateStr.slice(2, 4)) - 1; // JavaScript months are 0-based
    const year = parseInt(dateStr.slice(4, 8));

    // Extract time components
    const hours = parseInt(timeStr.slice(0, 2));
    const minutes = parseInt(timeStr.slice(2, 4));

    // Construct local (IST) date
    const date = new Date(year, month, day, hours, minutes);

    return date; // This will be in local system time (typically IST on Indian servers)
  } catch (err) {
    console.warn(`Invalid DTDC date/time format: ${dateStr} ${timeStr}`);
    return null;
  }
};

const formatAmazonDate = (isoDateStr) => {
  try {
    const d = new Date(isoDateStr);
    return d.toISOString(); // already UTC, just standardize
  } catch (err) {
    console.warn("Invalid Amazon date:", isoDateStr);
    return null;
  }
};

const formatSmartShipDateTime = (dateTimeStr) => {
  if (!dateTimeStr || typeof dateTimeStr !== "string") return null;

  try {
    // Input: "29-07-2025 23:01:06"
    const [datePart, timePart] = dateTimeStr.trim().split(" ");
    const [day, month, year] = datePart.split("-").map(Number);
    const [hours, minutes, seconds] = timePart.split(":").map(Number);

    // Create a Date in UTC directly using Date.UTC
    const utcDate = new Date(
      Date.UTC(year, month - 1, day, hours, minutes, seconds)
    );

    // Return ISO string without shifting (i.e., time stays 23:01:06)
    return utcDate.toISOString();
  } catch (err) {
    console.warn("Invalid SmartShip date format:", dateTimeStr);
    return null;
  }
};

const updateNdrHistoryByAwb = async (awb_number) => {
  try {
    const order = await Order.findOne({ awb_number });

    if (!order) {
      console.log(`❌ Order not found for AWB: ${awb_number}`);
      return;
    }

    const initialLength = order.ndrHistory.length;

    // Get keys from mapping (lowercase for matching)
    const statusKeys = Object.keys(DTDCStatusMapping).map((s) =>
      s.toLowerCase()
    );

    // Filter out remarks that match any mapping key
    const filteredNdrHistory = order.ndrHistory.filter(
      (ndr) => !statusKeys.includes(ndr.remark?.toLowerCase())
    );

    if (filteredNdrHistory.length < initialLength) {
      // Optional: Renumber attempts sequentially
      order.ndrHistory = filteredNdrHistory.map((ndr, index) => ({
        ...ndr,
        attempt: index + 1,
      }));

      await order.save();

      console.log(
        `✅ Updated order ${awb_number} — Removed ${
          initialLength - filteredNdrHistory.length
        } NDR entries`
      );
    } else {
      console.log(
        `ℹ️ No matching NDR remarks to remove for order ${awb_number}`
      );
    }
  } catch (error) {
    console.error("❌ Error updating order by AWB:", error);
  }
};

// updateNdrHistoryByAwb("I75008816");

module.exports = { trackSingleOrder, startTrackingLoop };
