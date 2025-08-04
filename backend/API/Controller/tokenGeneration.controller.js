const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../../models/User.model"); // adjust the path as needed
const { validateEmail } = require("../../utils/afv"); // adjust path if needed

const generateToken = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Check for empty fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // 2. Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // 3. Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 4. Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    // 5. Create JWT payload
    const payload = {
      user: {
        id: user._id,
        email: user.email,
        fullname: user.fullname,
        kyc: user.kycDone,
        isAdmin: user.isAdmin,
        isEmployee: false,
      },
    };

    // 6. Sign JWT token
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    // 7. Respond with token
    return res.status(200).json({
      success: true,
      message: "Token generated successfully",
      data: {
        token,
        user: {
          id: user.userId,
          fullname: user.fullname,
          email: user.email,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = generateToken;
