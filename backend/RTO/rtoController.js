const Order = require("../models/newOrder.model");
const Plan = require("../models/Plan.model");
const rateCards = require("../models/rateCards");
const users = require("../models/User.model");
const wallet = require("../models/wallet");
const cron = require("node-cron");
const zoneManagementController = require("../Rate/zoneManagementController");
const getZone = zoneManagementController.getZone;
const rtoCharges = async () => {
  try {
    const gstRate = 18;
    const orders = await Order.find({
      status: "RTO Delivered",
      RTOCharges: { $exists: false },
    });

    console.log("Total RTO Orders Found:", orders.length);

    for (const item of orders) {
      try {
        console.log("Processing AWB:", item.awb_number || "No AWB");

        const result = await getZone(
          item.pickupAddress.pinCode,
          item.receiverAddress.pinCode
        );
        const currentZone = result.zone;

        const plans = await Plan.findOne({ userId: item.userId });
        const ratecards = await rateCards.findOne({
          plan: plans.planName,
          courierServiceName: item.courierServiceName,
        });

        const extraWeight =
          item.packageDetails.applicableWeight * 1000 -
          ratecards.weightPriceBasic[0].weight;
        const extraWeightCount = Math.ceil(
          extraWeight / ratecards.weightPriceAdditional[0].weight
        );

        let basicChargef = parseFloat(
          ratecards.weightPriceBasic[0][currentZone]
        );
        let charges = basicChargef;

        if (extraWeight !== 0) {
          charges +=
            parseFloat(ratecards.weightPriceAdditional[0][currentZone]) *
            extraWeightCount;
        }

        let codCharges = 0;
        if (item.paymentDetails.method === "COD") {
          codCharges = Math.max(
            ratecards.codCharge,
            item.paymentDetails.amount * (ratecards.codPercent / 100)
          );
        }

        const gstAmountForward = parseFloat(
          (charges * (gstRate / 100)).toFixed(2)
        );
        const totalChargesReverse = charges + gstAmountForward;

        const awb = item.awb_number || "";
        const codDescription = "COD Charges Reversed";
        const rtoDescription = "RTO Freight Charges Applied";
        const currentDate = new Date()
          .toISOString()
          .slice(0, 16)
          .replace("T", " ");

        const user = await users.findOne({ _id: item.userId });
        const Wallet = await wallet.findOne({ _id: user.Wallet });

        // Helper: Remove transaction and update balance
        const removeTransactionAndUpdateBalance = async (
          walletDoc,
          awb_number,
          description
        ) => {
          const existingTx = walletDoc.transactions.find(
            (tx) =>
              tx.awb_number === awb_number && tx.description === description
          );

          if (existingTx) {
            const amount = existingTx.amount;
            const isCredit = existingTx.category === "credit";

            // Remove the transaction
            await wallet.updateOne(
              { _id: walletDoc._id },
              {
                $pull: {
                  transactions: {
                    awb_number,
                    description,
                  },
                },
                $inc: {
                  balance: isCredit ? -amount : amount, // Adjust balance
                },
              }
            );
          }
        };

        // ❌ Remove duplicates if exist and update balance
        await removeTransactionAndUpdateBalance(Wallet, awb, codDescription);
        await removeTransactionAndUpdateBalance(Wallet, awb, rtoDescription);

        // ✅ Update order with RTO charges
        await Order.updateOne(
          { _id: item._id },
          { $set: { RTOCharges: totalChargesReverse.toFixed(2) } }
        );

        // ✅ Add COD credit
        await wallet.updateOne(
          { _id: Wallet._id },
          {
            $inc: { balance: codCharges },
            $push: {
              transactions: {
                channelOrderId: item.orderId || null,
                category: "credit",
                amount: codCharges,
                balanceAfterTransaction: Wallet.balance + codCharges,
                date: currentDate,
                awb_number: awb,
                description: codDescription,
              },
            },
          }
        );

        // ✅ Add RTO charge debit
        await wallet.updateOne(
          { _id: Wallet._id },
          {
            $inc: { balance: -totalChargesReverse },
            $push: {
              transactions: {
                channelOrderId: item.orderId || null,
                category: "debit",
                amount: totalChargesReverse,
                balanceAfterTransaction: Wallet.balance - totalChargesReverse,
                date: currentDate,
                awb_number: awb,
                description: rtoDescription,
              },
            },
          }
        );
      } catch (innerErr) {
        console.error(
          "❌ Error processing order:",
          item._id,
          "AWB:",
          item.awb_number,
          innerErr
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in rtoCharges main block:", error);
  }
};

cron.schedule("0 */3 * * *", () => {
  console.log("⏰ Running scheduled task every 3 hours: Fetching orders...");
  rtoCharges();
});

// module.exports = {
//   rtoCharges,
// };
