const Aadhaar = require("../models/Aadhaar.model");
const BankAccount = require("../models/BankAccount.model");
const kyc = require("../models/Kyc.model");
const Pan = require("../models/Pan.model");
const GST = require("../models/Gstin.model");
const BillingInfo = require("../models/billingInfo.model");

const kycdata = async (req, res) => {};
const getAadhaar = async (req, res) => {
  try {
    const userId = req.user._id;
    const Aadhaars = await Aadhaar.findOne({ user: userId });
    if (!Aadhaars) {
      return res.status(204).json({ message: "pending" });
    }
    return res.status(200).json(Aadhaars);
  } catch (error) {
    console.error("Error fetching Aadhaar data:", error);
    return res
      .status(500)
      .json({ error: "An error occurred while fetching Aadhaar data" });
  }
};

const getBillingInfo = async (req, res) => {
  try {
    const userId = req.user._id;
    const billingInfo = await BillingInfo.findOne({ user: userId });
    if (!billingInfo) {
      return res.status(204).json({ message: "pending" });
    }
    console.log(billingInfo);
    return res.status(200).json(billingInfo);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "An error occurred while fetching Billing Info" });
  }
}

const getPan = async (req, res) => {
  try {
    const userId = req.user._id;
    const pan = await Pan.findOne({ user: userId });
    if (!pan) {
      return res.status(204).json({ message: "pending" });
    }
    return res.status(200).json(pan);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "An error occurred while fetching Pan data" });
  }
};

const getBankAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    const Bank = await BankAccount.findOne({ user: userId });
    console.log(Bank);
    if (!Bank) {
      return res.status(204).json({ message: "pending" });
    }
    return res.status(200).json(Bank);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "An error occurred while fetching Pan data" });
  }
};

const getGST = async (req, res) => {
  try {
    const userId = req.user._id;
    const gst = await GST.findOne({ user: userId });
    // console.log(Bank);
    if (!gst) {
      return res.status(204).json({ message: "pending" });
    }
    return res.status(200).json(gst);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "An error occurred while fetching Pan data" });
  }
};

const getAddress = async (req, res) => {};

module.exports = {
  kycdata,
  getAadhaar,
  getPan,
  getBankAccount,
  getGST,
  getAddress,
  getBillingInfo
};
