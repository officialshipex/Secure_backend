const express = require("express");
const router = express.Router();
const { getOrdersByStatus,searchUser,getAllOrdersByNdrStatus,getAllOrdersByManualRtoStatus, filterOrders, filterNdrOrders, filterOrdersForEmployee, filterNdrOrdersForEmployee, getAllOrdersByManualRtoStatusForEmployee } = require("../Admin/order");
const {getDashboardStats}=require("../Admin/dashboard");
const { isAuthorized } = require("../middleware/auth.middleware");

router.get("/adminOrder", getOrdersByStatus);

router.get("/filterOrders", filterOrders);
router.get("/filterNdrOrders", filterNdrOrders);
router.get("/searchUser",searchUser)
router.get("/adminNdr",getAllOrdersByNdrStatus)
router.get("/manualRto",getAllOrdersByManualRtoStatus)
router.get("/dashboard",getDashboardStats)

router.get("/filterEmployeeOrders",isAuthorized ,filterOrdersForEmployee)
router.get("/filterNdrOrdersForEmployee",isAuthorized ,filterNdrOrdersForEmployee)
router.get("/getAllOrdersByManualRtoStatusForEmployee",isAuthorized ,getAllOrdersByManualRtoStatusForEmployee)


module.exports = router;
