const mongoose = require("mongoose");
const Plan = require("../models/Plan.model");
const Warehouse = require("../models/wareHouse.model");
const Order = require("../models/orderSchema.model");
const Wallet = require("./wallet");
const CodPlan = require("../COD/codPan.model");
const usersSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      unique: true,
      required: true,
    },
    phoneNumber: {
      type: String,
    },
    company: {
      type: String,
    },
    monthlyOrders: {
      type: String,
    },
    password: {
      type: String,
    },
    googleOAuthID: {
      type: String,
    },
    oAuthType: {
      type: Number,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    provider: {
      type: String,
      default: "Credentials",
    },
    kycDone: {
      type: Boolean,
      default: false,
    },
    userId: {
      type: Number,
      required: true,
    },
    wareHouse: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Warehouse",
      },
    ],
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    Wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    adminTab: {
      type: Boolean,
      default: false,
    },
    // ✅ NEW FIELDS
    brandName: {
      type: String,
      default: "",
    },
    website: {
      type: String,
      default: "",
    },
    profileImage: {
      type: String,
      default: "", // This will store the S3 URL
    },
  },
  { timestamps: true }
);

usersSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      const wallet = new Wallet({
        balance: 0,
        transactions: [],
      });
      const savedWallet = await wallet.save();
      this.Wallet = savedWallet._id;

      const codPlan = new CodPlan({
        user: this._id, // Associate with User
        planName: "D+7", // Default plan
      });

      await codPlan.save();
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

const User = mongoose.model("User", usersSchema);

module.exports = User;
