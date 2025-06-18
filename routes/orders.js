const router = require("express").Router();
const Stocks = require("../models/Stocks");
const Company = require("../models/Company");
const Orders = require('../models/Orders');
const User = require("../models/User");
const fetchUser = require("../middleware/fetchUser");

// Data Fetching API Endpoint
router.post("/fetch", fetchUser, async (req, res) => {
  let success = false;
  const { order_type, order_sub_type, status, time_in_force} = req.body;

    try {
      const userId = req.user.id;

      const queryConditions = { user_id: userId };

      if (order_type) {
        queryConditions.order_type = order_type;
      }
      if (order_sub_type) {
        queryConditions.order_sub_type = order_sub_type;
      }
      if (status) {
        queryConditions.status = status;
      }
      if (time_in_force) {
        queryConditions.time_in_force = time_in_force;
      }

      const orders = await Orders.find(queryConditions).lean();

      // Fetching company for each order 
      for (let order of orders) {
        const company = await Company.findById(order.company_id);
        if (company) {
          order.company = company.symbol;
        } else {
          order.company = "Unknown";
        }
      }   
      success = true;
      res.json({ success, orders });
    } catch (error) {
      console.log(error.message);
      res.status(500).json({ success, msg: "Internal error" });
    }
});

module.exports = router;
