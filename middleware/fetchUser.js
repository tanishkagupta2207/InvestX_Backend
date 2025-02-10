const jwt = require('jsonwebtoken');
require("dotenv").config();

const fetchUser = (req, res, next)=>{
    //get user from jwt token and add id to req object
    const token = req.header('auth-token');
    if(!token){
        res.res(401).json({success: false, msg: "User not validated !"});
    }
    try {
        const data = jwt.verify(token, process.env.REACT_APP_JWT_SECRET);
        req.user = data.user;
        next();
    } catch (error) {
        res.status(401).json({success: false, msg: "User not validated!"});
    }
}

module.exports = fetchUser;