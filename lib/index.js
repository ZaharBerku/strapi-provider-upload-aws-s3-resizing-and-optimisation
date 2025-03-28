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

    function getFileFormat(file) {
      const ext = file.ext?.toLowerCase();
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
        if (file?.ext) {
          const fileType = "origin";
          const fileFormat = getFileFormat(file);
          if (
            !file.hash.startsWith("thumbnail_") &&
            !file.hash.startsWith("small_")
          ) {
            if (fileFormat === "image") {
              const formats = {};
              const buffers = [
                {
                  buffer: file.buffer,
                  path: `${fileType}/${file.hash}${file.ext}`,
                  mime: file.mime,
                  isOrigin: true,
                },
              ];

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
                }

                const sizePath = `${size.name}/${file.hash}${file.ext}`;
                strapi.log.info(`🔄 Generated image ${sizePath}`);
                formats[size.name] = {
                  origin: {
                    ext: file.ext,
                    url: `${S3BaseUrl}/images/${size.name}/${file.hash}${file.ext}`,
                    hash: file.hash,
                    mime: file.mime,
                    name: file.name,
                    width: size.resizeOptions?.width || null,
                    height: size.resizeOptions?.height || null,
                    size: Buffer.byteLength(resizedBuffer) / 1024,
                    path: sizePath,
                  },
                  ...(formats[size.name] || {}),
                };
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

                  const webpPath = `${size.name}/${file.hash}.webp`;
                  strapi.log.info(`🔄 Generated webp ${webpPath}`);
                  formats[size.name] = {
                    webp: {
                      ext: ".webp",
                      url: `${S3BaseUrl}/images/${size.name}/${file.hash}.webp`,
                      hash: file.hash,
                      mime: file.mime,
                      name: file.name,
                      width: size.resizeOptions?.width || null,
                      height: size.resizeOptions?.height || null,
                      size: Buffer.byteLength(resizedBuffer) / 1024,
                      path: sizePath,
                    },
                    ...(formats[size.name] || {}),
                  };
                  buffers.push({
                    buffer: webpBuffer,
                    path: webpPath,
                    mime: "image/webp",
                  });
                }
                if (size.isGenerateAvif && file.ext !== ".avif") {
                  const avifBuffer = await Sharp(file.buffer)
                    .toFormat("avif")
                    .resize(size.resizeOptions || {})
                    .rotate()
                    .avif(optimizeOptions.avif)
                    .toBuffer();

                  const avifPath = `${size.name}/${file.hash}.avif`;
                  strapi.log.info(`🔄 Generated avif ${avifPath}`);
                  formats[size.name] = {
                    avif: {
                      ext: ".avif",
                      url: `${S3BaseUrl}/images/${size.name}/${file.hash}.avif`,
                      hash: file.hash,
                      mime: file.mime,
                      name: file.name,
                      width: size.resizeOptions?.width || null,
                      height: size.resizeOptions?.height || null,
                      size: Buffer.byteLength(resizedBuffer) / 1024,
                      path: sizePath,
                    },
                    ...(formats[size.name] || {}),
                  };
                  buffers.push({
                    buffer: avifBuffer,
                    path: avifPath,
                    mime: "image/avif",
                  });
                }
              }

              for (const item of buffers) {
                await uploadToS3({
                  Key: `images/${item.path}`,
                  Body: item.buffer,
                  ACL: "public-read",
                  ContentType: item.mime,
                  ...customParams,
                });
                strapi.log.info(`✅ Uploaded ${item.path}`);
              }
              file.formats = formats;
              file.url = `${S3BaseUrl}/images/${fileType}/${file.hash}${file.ext}`;
            } else {
              await uploadToS3({
                Key: `${fileFormat}s/${file.hash}${file.ext}`,
                Body: Buffer.from(file.buffer),
                ACL: "public-read",
                ContentType: file.mime,
                ...customParams,
              });
              strapi.log.info(
                `✅ Uploaded ${fileFormat}s/${file.hash}${file.ext}`
              );
              file.url = `${S3BaseUrl}/${fileFormat}s/${file.hash}${file.ext}`;
            }
          }
        }
      },

      async delete(file, customParams = {}) {
        const fileType = "origin";
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
                  Key: `images/${size.name}/${file.hash}.webp`,
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
