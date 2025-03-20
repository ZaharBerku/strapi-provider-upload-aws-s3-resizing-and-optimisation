"use strict";

const AWS = require("aws-sdk");
const Sharp = require("sharp");

module.exports = {
  init({ imageSizes, optimizeOptions, settings, ...config }) {
    const S3 = new AWS.S3({
      apiVersion: "2006-03-01",
      ...config,
    });

    const S3BaseUrl = config.cdn
      ? config.cdn
      : `https://${config.params.Bucket}.s3.${config.region}.amazonaws.com`;

    function getFileType(file) {
      return file.hash.startsWith("thumbnail_") ? "thumbnail" : "origin";
    }

    function getFileFormat(file) {
      const ext = file.ext.toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp", ".tiff"].includes(ext))
        return "image";
      if (ext === ".svg") return "icon";
      return "file";
    }

    function uploadToS3(params) {
      return S3.upload(params).promise();
    }

    function deleteFromS3(params) {
      return S3.deleteObject(params).promise();
    }

    return {
      async upload(file, customParams = {}) {
        const fileType = getFileType(file);
        const fileFormat = getFileFormat(file);
        strapi.log.info(`${fileType}-${fileFormat}`);
        if (fileFormat === "image") {
          const buffers = [
            {
              buffer: file.buffer,
              path: `${fileType}/${file.hash}${file.ext}`,
              mime: file.mime,
              isOrigin: true,
            },
          ];

          if (fileType !== "thumbnail") {
            for (const size of imageSizes) {
              let resizedBuffer = await Sharp(file.buffer)
                .resize(size.resizeOptions || {})
                .rotate();

              if (file.ext === ".jpeg" || file.ext === ".jpg") {
                resizedBuffer = await resizedBuffer
                  .jpeg(optimizeOptions.jpeg)
                  .toBuffer();
              } else if (file.ext === ".png") {
                resizedBuffer = await resizedBuffer
                  .png(optimizeOptions.png)
                  .toBuffer();
              } else if (file.ext === ".webp") {
                resizedBuffer = await resizedBuffer
                  .webp(optimizeOptions.webp)
                  .toBuffer();
              } else if (file.ext === ".tiff") {
                resizedBuffer = await resizedBuffer
                  .tiff(optimizeOptions.tiff)
                  .toBuffer();
              }

              const sizePath = `${size.name}/${file.hash}${file.ext}`;
              strapi.log.info(`🔄 Generated image ${sizePath}`);
              buffers.push({
                buffer: resizedBuffer,
                path: sizePath,
                mime: file.mime,
              });

              if (size.isGenerateWebp && file.ext !== ".webp") {
                const webpBuffer = await Sharp(file.buffer)
                  .toFormat("webp")
                  .resize(size.resizeOptions || {})
                  .rotate()
                  .webp(optimizeOptions.webp)
                  .toBuffer();

                const webpPath = `webp/${size.name}/${file.hash}.webp`;
                strapi.log.info(`🔄 Generated webp ${webpPath}`);
                buffers.push({
                  buffer: webpBuffer,
                  path: webpPath,
                  mime: "image/webp",
                });
              }
            }
          }

          for (const item of buffers) {
            await uploadToS3({
              Key: `images/${item.path}`,
              Body: file.buffer,
              ACL: "public-read",
              ContentType: item.mime,
              ...customParams,
            });
            strapi.log.info(`✅ Uploaded ${item.path}`);
          }

          file.url = `${S3BaseUrl}/images/${fileType}/${file.hash}${file.ext}`;
        } else {
          await uploadToS3({
            Key: `${fileFormat}s/${file.hash}${file.ext}`,
            Body: Buffer.from(file.buffer),
            ACL: "public-read",
            ContentType: file.mime,
            ...customParams,
          });
          strapi.log.info(`✅ Uploaded ${fileFormat}s/${file.hash}${file.ext}`);
          file.url = `${S3BaseUrl}/${fileFormat}s/${file.hash}${file.ext}`;
        }
      },

      async delete(file, customParams = {}) {
        const fileType = getFileType(file);
        const fileFormat = getFileFormat(file);

        if (fileFormat === "image") {
          await deleteFromS3({
            Key: `images/${fileType}/${file.hash}${file.ext}`,
            ...customParams,
          });
          strapi.log.info(
            `❌ Deleted images/${fileType}/${file.hash}${file.ext}`
          );

          if (fileType !== "thumbnail") {
            for (const size of imageSizes) {
              if (file.ext !== ".webp") {
                await deleteFromS3({
                  Key: `images/${size.name}/${file.hash}${file.ext}`,
                  ...customParams,
                });
                strapi.log.info(
                  `❌ Deleted images/${size.name}/${file.hash}${file.ext}`
                );
              }

              if (size.isGenerateWebp) {
                await deleteFromS3({
                  Key: `images/webp/${size.name}/${file.hash}.webp`,
                  ...customParams,
                });
                strapi.log.info(
                  `❌ Deleted images/webp/${size.name}/${file.hash}.webp`
                );
              }
            }
          }
        } else {
          await deleteFromS3({
            Key: `${fileFormat}s/${file.hash}${file.ext}`,
            ...customParams,
          });
          strapi.log.info(`❌ Deleted ${fileFormat}s/${file.hash}${file.ext}`);
        }
      },
    };
  },
};
