const AllCourier = require('../models/AllCourierSchema');

const getAllCouriers = async (req, res) => {
    try {
      const couriers = await AllCourier.find();
      res.status(200).json(couriers);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };


  const deleteCourier = async (req, res) => {
    try {
      const { id } = req.params;
      const deletedCourier = await AllCourier.findByIdAndDelete(id);
  
      if (!deletedCourier) {
        return res.status(404).json({ message: 'Courier not found' });
      }
  
      res.status(200).json({ message: 'Courier deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };



const updateStatusController = async (req, res) => {
  try {
    // const { provider } = req.params; // e.g., 'DTDC'
    const { provider,status } = req.body;     // 'Enable' or 'Disable'

    // Find and update by provider field
    const courier = await AllCourier.findOneAndUpdate(
      { courierProvider: provider },
      { status },
      { new: true }
    );
    if (!courier) {
      return res.status(404).json({ message: 'Courier not found' });
    }
    res.json({ message: 'Status updated', courier });
  } catch (error) {
    res.status(500).json({ message: 'Error updating status', error });
  }
};


  module.exports = {getAllCouriers, deleteCourier,updateStatusController};