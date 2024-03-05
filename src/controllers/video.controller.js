import mongoose, { isValidObjectId } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { Video } from "../models/video.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { Like } from "../models/like.model.js";
import { Comment } from "../models/comment.model.js";

const getAllVideos = asyncHandler(async (req, res) => {
  // Destructuring to extract values from req.query
  const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;

  try {
    // Initialize the empty arrya to store the aggregation pipeline stages
    let pipeline = [];

    // if userId is provided, add a $match stage to filter videos by owner
    if (userId) {
      pipeline.push({
        $match: { owner: new mongoose.Types.ObjectId(userId) },
      });
    }

    // if sortBy and sortType are provided, add a $sort stage to sort the videos
    if (sortBy && sortType) {
      const sortOptions = {};
      sortOptions[sortBy] = sortType === "description" ? -1 : 1;
      pipeline.push({
        $sort: sortOptions,
      });
    }

    // add $skip and $limit stages for pagination
    pipeline.push(
      {
        $skip: (page - 1) * parseInt(limit),
      },
      {
        $limit: parseInt(limit),
      }
    );

    // use $lookup to join with the "users" collection and fetch owner details
    pipeline.push({
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "ownerDetails",
      },
    });

    // use $unwind to destructure the array created by $lookup
    pipeline.push({
      $unwind: "$ownerDetails",
    });

    // use $project to shape the final output by selecting specific fields
    pipeline.push({
      $project: {
        videoFile: 1,
        thumbnail: 1,
        title: 1,
        duration: 1,
        views: 1,
        owner: {
          _id: "$ownerDetails._id",
          fullName: "$ownerDetails.fullName",
          avatar: "$ownerDetails.avatar",
        },
      },
    });

    // use the aggregation pipeline to fetch videos
    const getVideos = await Video.aggregate(pipeline);

    // check if videos are found
    if (!getVideos || getVideos.length === 0) {
      return res.status(200).json(new ApiResponse(404, [], "No Videos found"));
    }

    // Respond with the fetched videos
    res.status(200).json(new ApiResponse(200, getVideos, "All videos fetched"));
  } catch (error) {
    throw new ApiError(
      500,
      error?.message || "Internal server error in getAll videos"
    );
  }
});

const publishAVideo = asyncHandler(async (req, res) => {
  const { title, description, thumbnail, videoFile } = req.body;
  // validate data
  // upload thumbnail and video file to cloudinary
  // create video
  // return video
  // console.log(title, description, thumbnail, videoFile)

  if (title === "" || description === "") {
    throw new ApiError(400, "All fields are required");
  }

  if (!req.files.thumbnail || !req.files.videoFile) {
    throw new ApiError(400, "Video file and thumbnail are required");
  }

  let thumbnailUrl = await uploadOnCloudinary(req?.files?.thumbnail[0].path);
  let videoFileUrl = await uploadOnCloudinary(req?.files?.videoFile[0].path);

  // console.log(req.files)
  if (!videoFileUrl || !thumbnailUrl) {
    throw new ApiError(400, "Video file and thumbnail are required");
  }
  console.log(videoFileUrl.url);
  console.log(videoFileUrl.duration);

  const video = await Video.create({
    title,
    description,
    thumbnail: thumbnailUrl.url,
    videoFile: videoFileUrl.url,
    duration: videoFileUrl.duration,
    owner: req.user._id,
  });
  return res.status(201).json(new ApiResponse(201, "Video created", video));
});

const getVideoById = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const video = await Video.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(videoId),
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            $project: {
              username: 1,
              avatar: 1,
              fullName: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "video",
        as: "likes",
      },
    },
    {
      $addFields: {
        owner: {
          $first: "$owner",
        },
        likes: {
          $size: "$likes",
        },
        views: {
          $add: [1, "$views"],
        },
      },
    },
  ]);

  if (video.length > 0) {
    video = video[0];
  }

  await Video.findByIdAndUpdate(videoId, {
    $set: {
      views: video.views,
    },
  });

  res.status(200).json(new ApiResponse(200, "Video found", video));
});

const updateVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const { title, description, thumbnail } = req.body;
  const video = await Video.findByIdAndUpdate(
    videoId,
    {
      $set: { title, description, thumbnail },
    },
    {
      new: true,
    }
  );

  res.status(200).json(new ApiResponse(200, "Video updated", video));
});

const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const video = await Video.findByIdAndDelete(videoId);
  const comments = await Comment.deleteMany({ video: videoId });
  const Likes = await Like.deleteMany({ video: videoId });

  if (!video || !comments || !Likes) {
    throw new ApiError(404, "Video, comments or likes not found");
  }

  res.status(200).json(new ApiResponse(200, "Video deleted"));
});

const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const video = await Video.findByIdAndUpdate({ _id: videoId }, [
    {
      $set: { isPublished: { $eq: [false, "$isPublished"] } },
    },
  ]);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, "Video isPublished status updated", video));
});

export {
  getAllVideos,
  publishAVideo,
  getVideoById,
  updateVideo,
  deleteVideo,
  togglePublishStatus,
};
