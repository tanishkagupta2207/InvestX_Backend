const router = require("express").Router();
const User = require("../models/User");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fetchUser = require("../middleware/fetchUser");
const Portfolio = require("../models/Portfolio");
require("dotenv").config();

// 1. Create a User using: POST "/api/auth/register". No login required
router.post(
  "/register",
  [
    body("userName", "UserName should have atleast 6 characters.").isLength({
      min: 6,
    }),
    body("name", "Name should have atleast 6 characters.").isLength({ min: 6 }),
    body("email", "Enter a valid email").isEmail(),
    body("password", "Password must be atleast 5 characters").isLength({
      min: 5,
    }),
  ],
  async (req, res) => {
    let success = false;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success, msg: errors.array()[0].msg });
    }

    try {
      let username = req.body.userName;
      let name = req.body.name;
      if (username.length < 6) {
        return res.status(400).json({ success, msg: "Username is too short." });
      }
      if (username.length > 16) {
        return res.status(400).json({ success, msg: "Username is too long." });
      }
      // Regex to check valid characters: letters, numbers, dots, underscores
      const pattern = /^[a-zA-Z0-9_]+$/;
      if (!pattern.test(username)) {
        return res.status(400).json({
          success,
          msg: "Username contains invalid characters. Only letters, numbers and underscores are allowed.",
        });
      }
      if (username[0] === "_") {
        return res
          .status(400)
          .json({ success, msg: "Username cannot start with underscore." });
      }
      if (username[-1] === "_") {
        return res
          .status(400)
          .json({ success, msg: "Username cannot end with underscore." });
      }

      if (name.length < 6) {
        return res.status(400).json({ success, msg: "Name is too short." });
      }
      if (name.length > 16) {
        return res.status(400).json({ success, msg: "Name is too long." });
      }
      const pattern2 = /^[a-zA-Z ]+$/;
      if (!pattern2.test(name)) {
        return res.status(400).json({
          success,
          msg: "Name contains invalid characters. Only letters are allowed.",
        });
      }

      //Check whether the user with this email or userName exists already
      let user = await User.findOne({ email: req.body.email });
      if (user) {
        return res
          .status(400)
          .json({ success, msg: "User with this email already exists" });
      }
      user = await User.findOne({ userName: req.body.userName });
      if (user) {
        return res
          .status(400)
          .json({ success, msg: "User with this userName already exists" });
      }
      const salt = await bcrypt.genSalt(10);
      secPswd = await bcrypt.hash(req.body.password, salt);

      //Creating new user
      user = await User.create({
        name: req.body.name,
        userName: req.body.userName,
        email: req.body.email,
        password: secPswd,
        profileType: req.body.profileType ? req.body.profileType : "Public",
      });

      //Create a portfolio
      const portfolio = await Portfolio.create({
        user_id: user.id,
      });

      const payload = {
        user: {
          id: user.id,
        },
      };
      // Token for authentication
      const authToken = jwt.sign(payload, process.env.REACT_APP_JWT_SECRET);
      success = true;
      res.json({ success, authToken });
    } catch (error) {
      console.log(error.message);
      res.status(500).json({ success, msg: "Internal error" });
    }
  }
);

// 2. Authenticate a User using: POST "/api/auth/login". No login required
router.post(
  "/login",
  [
    body("email", "Enter a valid email").isEmail(),
    body("password", "Password cannot be blank").exists(),
  ],
  async (req, res) => {
    let success = false;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success, msg: errors.array()[0].msg });
    }
    const { email, password } = req.body;
    try {
      let user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({
          success,
          msg: "Please try to login using correct credentials",
        });
      }
      const pswdCompare = await bcrypt.compare(password, user.password);
      if (!pswdCompare) {
        return res.status(400).json({
          success,
          msg: "Please try to login using correct credentials",
        });
      }
      const payload = {
        user: {
          id: user.id,
        },
      };
      const authToken = jwt.sign(payload, process.env.REACT_APP_JWT_SECRET);
      success = true;
      res.json({ success, authToken });
    } catch (error) {
      console.log(error.message);
      res.status(500).json({ success, msg: "Internal error" });
    }
  }
);

// 3. Get User details using: GET "/api/auth/getUser". Login required
router.get("/getUser", fetchUser, async (req, res) => {
  let success = false;
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("-password");
    success = true;
    res.json({ success, user });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success, msg: "Internal error" });
  }
});

// 1. Edit a User using: POST "/api/auth/editAccount". Login required
router.post(
  "/editAccount",
  [
    body("userName", "UserName should have atleast 6 characters.").isLength({
      min: 6,
    }),
    body("name", "Name should have atleast 6 characters.").isLength({ min: 6 }),
    body("profileType", "Profile type should be either Public or Private").isIn(
      ["Public", "Private"]
    ),
  ],
  fetchUser,
  async (req, res) => {
    let success = false;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success, msg: errors.array()[0].msg });
    }

    try {
      const userId = req.user.id;
      let username = req.body.userName;
      let name = req.body.name;
      if (username.length < 6) {
        return res.status(400).json({ success, msg: "Username is too short." });
      }
      if (username.length > 16) {
        return res.status(400).json({ success, msg: "Username is too long." });
      }
      // Regex to check valid characters: letters, numbers, dots, underscores
      const pattern = /^[a-zA-Z0-9_]+$/;
      if (!pattern.test(username)) {
        return res.status(400).json({
          success,
          msg: "Username contains invalid characters. Only letters, numbers and underscores are allowed.",
        });
      }
      if (username[0] === "_") {
        return res
          .status(400)
          .json({ success, msg: "Username cannot start with underscore." });
      }
      if (username[-1] === "_") {
        return res
          .status(400)
          .json({ success, msg: "Username cannot end with underscore." });
      }

      if (name.length < 6) {
        return res.status(400).json({ success, msg: "Name is too short." });
      }
      if (name.length > 16) {
        return res.status(400).json({ success, msg: "Name is too long." });
      }
      const pattern2 = /^[a-zA-Z ]+$/;
      if (!pattern2.test(name)) {
        return res.status(400).json({
          success,
          msg: "Name contains invalid characters. Only letters are allowed.",
        });
      }

      const originalUser = await User.findById(userId);

      let user = await User.findOne({ userName: req.body.userName });
      if (user && user._id.toString() !== userId) {
        return res.status(400).json({
          success,
          msg: "A User with this userName already exists. Pls select another User Name.",
        });
      }
      //Updating the original user
      originalUser.name = req.body.name;
      originalUser.userName = req.body.userName;
      originalUser.profileType = req.body.profileType;
      await originalUser.save();
      success = true;
      res.json({ success, msg: "Profile updated successfully." });
    } catch (error) {
      console.log(error.message);
      res.status(500).json({ success, msg: "Internal error" });
    }
  }
);

module.exports = router;
