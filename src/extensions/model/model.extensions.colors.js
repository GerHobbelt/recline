(function ($) {

    recline.Model.Dataset = recline.Model.Dataset.extend({
        setColorSchema:function () {
            var self = this;
            _.each(self.attributes.colorSchema, function (d) {
                var field = _.find(self.fields.models, function (f) {
                    return d.field === f.id
                });
                if (field != null)
                    field.attributes.colorSchema = d.schema;
            })

        }
    });


    recline.Model.Record = recline.Model.Record.extend({
        getFieldColor:function (field) {
            if (!field.attributes.colorSchema)
                return null;

            if (field.attributes.is_partitioned) {
                return field.attributes.colorSchema.getTwoDimensionalColor(field.attributes.partitionValue, this.getFieldValueUnrendered(field));
            }
            else
                return field.attributes.colorSchema.getColorFor(this.getFieldValueUnrendered(field));

        }
    });

    recline.Model.Field = recline.Model.Field.extend({
    getColorForPartition:function () {

        if (!this.attributes.colorSchema)
            return null;

        if (this.attributes.is_partitioned)
            return this.attributes.colorSchema.getColorFor(this.attributes.partitionValue);

        return this.attributes.colorSchema.getColorFor(this.attributes.id);
    }
    });


}(jQuery));