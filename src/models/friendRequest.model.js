// models/friendRequest.model.js
import mongoose from "mongoose";

const friendRequestSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" }
}, { timestamps: true });

/* Prevent duplicate pending requests in either direction */
friendRequestSchema.index(
    { sender: 1, receiver: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } }
);

export default mongoose.model("FriendRequest", friendRequestSchema);
